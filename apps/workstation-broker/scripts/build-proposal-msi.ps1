[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$brokerRoot = Split-Path -Parent $PSScriptRoot
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
$serviceOutput = Join-Path $brokerRoot 'artifacts\service'
$companionOutput = Join-Path $brokerRoot 'artifacts\companion'
$nugetConfig = Join-Path $brokerRoot 'NuGet.Config'

& $dotnet restore (Join-Path $brokerRoot 'PaulOs.WorkstationBroker.slnx') `
    --locked-mode --configfile $nugetConfig
if ($LASTEXITCODE -ne 0) { throw 'Locked broker restore failed.' }
& $dotnet restore (Join-Path $brokerRoot 'installer\PaulOs.WorkstationBroker.Installer.wixproj') `
    --locked-mode --configfile $nugetConfig
if ($LASTEXITCODE -ne 0) { throw 'Locked installer restore failed.' }

& $dotnet publish (Join-Path $brokerRoot 'src\PaulOs.WorkstationBroker.Service\PaulOs.WorkstationBroker.Service.csproj') `
    -c Release -r win-x64 --self-contained true --no-restore `
    -p:PublishSingleFile=true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    -o $serviceOutput
if ($LASTEXITCODE -ne 0) { throw 'Broker service publish failed.' }

& $dotnet publish (Join-Path $brokerRoot 'src\PaulOs.WorkstationBroker.Companion\PaulOs.WorkstationBroker.Companion.csproj') `
    -c Release -r win-x64 --self-contained true --no-restore `
    -p:PublishSingleFile=true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    -o $companionOutput
if ($LASTEXITCODE -ne 0) { throw 'Broker companion publish failed.' }

& $dotnet build (Join-Path $brokerRoot 'installer\PaulOs.WorkstationBroker.Installer.wixproj') `
    -c Release --no-restore `
    -p:ServicePublishDir=$serviceOutput `
    -p:CompanionPublishDir=$companionOutput
if ($LASTEXITCODE -ne 0) { throw 'Unsigned proposal MSI build failed.' }

Write-Warning 'The generated MSI is unsigned and is for local proposal/demo use only.'
