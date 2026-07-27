$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$env:HELIUS_API_KEY = [Environment]::GetEnvironmentVariable(
  "HELIUS_API_KEY",
  "User"
)
$env:MT5_INGEST_SECRET = [Environment]::GetEnvironmentVariable(
  "MT5_INGEST_SECRET",
  "User"
)
$env:MT5_INGEST_URL = [Environment]::GetEnvironmentVariable(
  "MT5_INGEST_URL",
  "User"
)

Set-Location -LiteralPath $projectRoot
& node ".\scripts\helius-collector.mjs"
