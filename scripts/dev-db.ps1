# Base de datos de DESARROLLO local: un PostgreSQL aislado en el puerto 54329,
# con sus datos en .local/pgdata (ignorado por git). No toca el servicio de
# PostgreSQL de Windows (puerto 5432) ni ninguna base remota.
#
#   .\scripts\dev-db.ps1 start    # crea el cluster la primera vez y lo arranca
#   .\scripts\dev-db.ps1 stop
#   .\scripts\dev-db.ps1 status
#
# Requiere PostgreSQL instalado (usa sus binarios, no su servicio).

param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'status')]
  [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'
$Port = 54329
$Database = 'restaurant_demos_dev'
$Root = Split-Path -Parent $PSScriptRoot
$DataDir = Join-Path $Root '.local\pgdata'
$LogFile = Join-Path $Root '.local\postgres.log'

$PgBin = Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -ErrorAction SilentlyContinue |
  Sort-Object { [int]$_.Name } -Descending |
  ForEach-Object { Join-Path $_.FullName 'bin' } |
  Where-Object { Test-Path (Join-Path $_ 'pg_ctl.exe') } |
  Select-Object -First 1
if (-not $PgBin) { throw 'No se encontró PostgreSQL en C:\Program Files\PostgreSQL.' }

function Test-Ready {
  & (Join-Path $PgBin 'pg_isready.exe') -h localhost -p $Port | Out-Null
  return $LASTEXITCODE -eq 0
}

switch ($Action) {
  'status' {
    if (Test-Ready) { "Arriba: postgres://postgres@localhost:$Port/$Database" } else { 'Detenida.' }
  }

  'stop' {
    if (-not (Test-Ready)) { 'Ya estaba detenida.'; break }
    & (Join-Path $PgBin 'pg_ctl.exe') -D $DataDir -m fast stop | Out-Null
    'Detenida.'
  }

  'start' {
    if (Test-Ready) { "Ya estaba arriba: postgres://postgres@localhost:$Port/$Database"; break }

    if (-not (Test-Path (Join-Path $DataDir 'PG_VERSION'))) {
      New-Item -ItemType Directory -Force (Split-Path -Parent $DataDir) | Out-Null
      & (Join-Path $PgBin 'initdb.exe') -D $DataDir -U postgres -A trust --encoding=UTF8 --locale=C | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'initdb falló.' }
    }

    # Start-Process y no una llamada directa: pg_ctl deja al servidor colgado
    # de la consola que lo lanzó, y al cerrarla se cae la base.
    $arguments = '-D "{0}" -l "{1}" -o "-p {2} -c listen_addresses=localhost" start' -f $DataDir, $LogFile, $Port
    Start-Process -FilePath (Join-Path $PgBin 'pg_ctl.exe') -ArgumentList $arguments -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Ready)) {
      if ((Get-Date) -gt $deadline) { throw "La base no respondió en 30 s. Revisa $LogFile" }
      Start-Sleep -Milliseconds 500
    }

    $exists = & (Join-Path $PgBin 'psql.exe') -h localhost -p $Port -U postgres -tAc "select 1 from pg_database where datname='$Database'"
    if ($exists -ne '1') { & (Join-Path $PgBin 'createdb.exe') -h localhost -p $Port -U postgres $Database }

    "Arriba: postgres://postgres@localhost:$Port/$Database"
  }
}
