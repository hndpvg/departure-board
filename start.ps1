param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$port = 4173
$url = "http://localhost:$port"
$root = $PSScriptRoot

function Test-Server {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connected = $client.ConnectAsync("127.0.0.1", $port).Wait(500)
    return $connected -and $client.Connected
  } catch {
    return $false
  } finally {
    $client.Dispose()
  }
}

function Find-Python {
  $candidates = @(
    "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe",
    "python",
    "py"
  )

  foreach ($candidate in $candidates) {
    try {
      $process = Start-Process -FilePath $candidate -ArgumentList "-c", "print('ready')" -Wait -PassThru -WindowStyle Hidden
      if ($process.ExitCode -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  return $null
}

if (-not (Test-Server)) {
  $python = Find-Python
  if (-not $python) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
      "Python was not found. Install Python and open start.bat again.",
      "Airport Departure Board"
    ) | Out-Null
    exit 1
  }

  Start-Process `
    -FilePath $python `
    -ArgumentList "-m", "http.server", $port, "--bind", "127.0.0.1" `
    -WorkingDirectory $root `
    -WindowStyle Minimized | Out-Null

  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    Start-Sleep -Milliseconds 300
    if (Test-Server) {
      break
    }
  }
}

if (-not (Test-Server)) {
  throw "The local server could not be started."
}

if (-not $NoBrowser) {
  Start-Process $url
}
