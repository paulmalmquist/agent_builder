[CmdletBinding()]
param(
    [switch]$SkipContractBuild
)

$ErrorActionPreference = 'Stop'
$brokerRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $brokerRoot '..\..')
$dotnet = Join-Path $env:ProgramFiles 'dotnet\dotnet.exe'
if (-not (Test-Path -LiteralPath $dotnet)) {
    throw '.NET SDK 10.0.302 is required.'
}

Push-Location $repoRoot
try {
    if (-not $SkipContractBuild) {
        npm run build -w '@agent-builder/contracts'
    }
    node (Join-Path $brokerRoot 'scripts\write-openapi.mjs')
    Push-Location $brokerRoot
    try {
        & $dotnet tool restore `
            --tool-manifest (Join-Path $brokerRoot '.config\dotnet-tools.json') `
            --configfile (Join-Path $brokerRoot 'NuGet.Config')
        if ($LASTEXITCODE -ne 0) { throw 'Kiota tool restore failed.' }
        & $dotnet tool run kiota -- generate `
            --openapi (Join-Path $brokerRoot 'openapi\paul-os.openapi.json') `
            --language CSharp `
            --class-name PaulOsControlPlaneClient `
            --namespace-name PaulOs.ControlPlane.Client.Generated `
            --output (Join-Path $brokerRoot 'src\PaulOs.ControlPlane.Client\Generated') `
            --clean-output true `
            --exclude-backward-compatible `
            --include-path '/live' `
            --include-path '/ready' `
            --include-path '/v1/session'
        if ($LASTEXITCODE -ne 0) { throw 'Kiota client generation failed.' }

        & npx --no-install prettier --write `
            (Join-Path $brokerRoot 'openapi\paul-os.openapi.json') `
            (Join-Path $brokerRoot 'src\PaulOs.ControlPlane.Client\Generated\kiota-lock.json')
        if ($LASTEXITCODE -ne 0) { throw 'Generated client formatting failed.' }
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
