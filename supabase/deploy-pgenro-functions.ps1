$ErrorActionPreference = 'Stop'
$ProjectRef = 'zssrxubajhqryrwijyzm'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

Push-Location $ProjectRoot
try {
    Write-Host 'Linking the PGENRO IMS Supabase project...' -ForegroundColor Cyan
    supabase link --project-ref $ProjectRef
    if ($LASTEXITCODE -ne 0) { throw 'Supabase project linking failed.' }

    foreach ($FunctionName in @('admin-users', 'employee-login', 'bootstrap-first-admin')) {
        Write-Host "Deploying $FunctionName..." -ForegroundColor Cyan
        supabase functions deploy $FunctionName --no-verify-jwt
        if ($LASTEXITCODE -ne 0) { throw "Deployment failed for $FunctionName." }
    }

    Write-Host 'All three PGENRO IMS Edge Functions were deployed.' -ForegroundColor Green
}
finally {
    Pop-Location
}
