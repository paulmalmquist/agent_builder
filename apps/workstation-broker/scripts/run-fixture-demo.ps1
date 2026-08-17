[CmdletBinding()]
param(
    [ValidateSet('resume', 'replay', 'expiry')]
    [string]$Scenario = 'resume',
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$brokerRoot = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
if (-not $SkipBuild) {
    & $dotnet build (Join-Path $brokerRoot 'PaulOs.WorkstationBroker.slnx') -c Release
    if ($LASTEXITCODE -ne 0) { throw 'Broker build failed.' }
}

$serviceDll = Join-Path $brokerRoot 'src\PaulOs.WorkstationBroker.Service\bin\Release\net10.0-windows10.0.17763.0\PaulOs.WorkstationBroker.Service.dll'
$companionDll = Join-Path $brokerRoot 'src\PaulOs.WorkstationBroker.Companion\bin\Release\net10.0-windows10.0.17763.0\PaulOs.WorkstationBroker.Companion.dll'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$demoRoot = [IO.Path]::GetFullPath((Join-Path $tempRoot "paul-os-broker-demo-$([Guid]::NewGuid().ToString('N'))"))
if (-not $demoRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fixture temporary directory escaped the system temporary root.'
}
[IO.Directory]::CreateDirectory($demoRoot) | Out-Null
$descriptor = Join-Path $demoRoot 'descriptor.json'
$result = Join-Path $demoRoot 'result.json'
$service = $null
$companion = $null

function Start-BrokerProcess([string[]]$Arguments) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $dotnet
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $start.Environment['DOTNET_ENVIRONMENT'] = 'Development'
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    return [Diagnostics.Process]::Start($start)
}

function Wait-ForFixtureFile([string]$Path, [int]$Seconds) {
    $deadline = [DateTimeOffset]::UtcNow.AddSeconds($Seconds)
    while (-not [IO.File]::Exists($Path)) {
        if ([DateTimeOffset]::UtcNow -ge $deadline) {
            throw "Fixture file was not created: $([IO.Path]::GetFileName($Path))"
        }
        Start-Sleep -Milliseconds 50
    }
}

try {
    $service = Start-BrokerProcess @(
        $serviceDll,
        '--WorkstationBroker:Mode=fixture',
        '--WorkstationBroker:FixtureMode=true',
        "--WorkstationBroker:FixtureScenario=$Scenario",
        "--WorkstationBroker:FixtureDescriptorPath=$descriptor",
        "--WorkstationBroker:FixtureResultPath=$result",
        '--WorkstationBroker:FixtureHandshakeTimeoutSeconds=30'
    )
    Wait-ForFixtureFile $descriptor 15
    if ($Scenario -ne 'expiry') {
        $companion = Start-BrokerProcess @($companionDll, '--fixture', '--descriptor', $descriptor)
        if (-not $companion.WaitForExit(20000) -or $companion.ExitCode -ne 0) {
            throw "Fixture companion failed: $($companion.StandardError.ReadToEnd())"
        }
    }
    Wait-ForFixtureFile $result 20
    if (-not $service.WaitForExit(20000) -or $service.ExitCode -ne 0) {
        throw "Fixture service failed: $($service.StandardError.ReadToEnd())"
    }
    Get-Content -Raw -LiteralPath $result | ConvertFrom-Json | ConvertTo-Json -Depth 10
}
finally {
    foreach ($process in @($service, $companion)) {
        if ($null -ne $process) {
            if (-not $process.HasExited) { $process.Kill($true) }
            $process.Dispose()
        }
    }
    if ([IO.Directory]::Exists($demoRoot)) {
        [IO.Directory]::Delete($demoRoot, $true)
    }
}
