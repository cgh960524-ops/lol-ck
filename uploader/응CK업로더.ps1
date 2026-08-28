Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:Root = if ($env:EUNGCK_UPLOADER_ROOT) { $env:EUNGCK_UPLOADER_ROOT.TrimEnd('\') } elseif ($MyInvocation.MyCommand.Path) { Split-Path -Parent $MyInvocation.MyCommand.Path } else { (Get-Location).Path }
$script:ConfigPath = Join-Path $script:Root "config.json"
$script:Config = @{ serverUrl = "http://127.0.0.1:4173"; uploadToken = ""; riotApiKey = "" }
if (Test-Path -LiteralPath $script:ConfigPath) {
    try { $loaded = Get-Content -LiteralPath $script:ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json; $script:Config.serverUrl = $loaded.serverUrl; $script:Config.uploadToken = $loaded.uploadToken; $script:Config.riotApiKey = $loaded.riotApiKey } catch {}
}

function Get-LcuAuth {
    $commandLine = Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" | Select-Object -First 1 -ExpandProperty CommandLine
    if (-not $commandLine) { throw "리그 오브 레전드 클라이언트를 먼저 실행해주세요." }
    $port = [regex]::Match($commandLine, '--app-port=([0-9]+)').Groups[1].Value
    $token = [regex]::Match($commandLine, '--remoting-auth-token=([^`" ]+)').Groups[1].Value
    if (-not $port -or -not $token) { throw "롤 클라이언트 연결 정보를 읽지 못했습니다." }
    return @{ Port = $port; Token = $token }
}

function Get-Role($participant) {
    if ($participant.timeline.lane -eq "TOP") { return "TOP" }
    if ($participant.timeline.lane -eq "JUNGLE") { return "JUNGLE" }
    if ($participant.timeline.lane -eq "MIDDLE") { return "MID" }
    if ($participant.timeline.role -eq "DUO_SUPPORT") { return "SUPPORT" }
    return "ADC"
}

function Get-InternalMatch([string]$gameId) {
    if ($gameId -notmatch '^\d{6,12}$') { throw "게임 ID는 숫자로 입력해주세요." }
    $auth = Get-LcuAuth
    $responseFile = Join-Path ([IO.Path]::GetTempPath()) ("eungck-lcu-" + [guid]::NewGuid().ToString("N") + ".json")
    try {
        & curl.exe -s -k -u "riot:$($auth.Token)" --output $responseFile "https://127.0.0.1:$($auth.Port)/lol-match-history/v1/games/$gameId"
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $responseFile)) { throw "롤 클라이언트에서 경기 기록을 가져오지 못했습니다." }
        $raw = [IO.File]::ReadAllText($responseFile, [Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { throw "롤 클라이언트가 빈 경기 기록을 반환했습니다." }
        try { $game = $raw | ConvertFrom-Json } catch { throw "롤 클라이언트 경기 기록의 JSON 형식을 읽지 못했습니다. 업로더를 최신 버전으로 다시 실행해주세요." }
    }
    finally {
        if (Test-Path -LiteralPath $responseFile) { Remove-Item -LiteralPath $responseFile -Force -ErrorAction SilentlyContinue }
    }
    if ($game.httpStatus) { throw "롤 클라이언트 기록에서 게임 $gameId 을(를) 찾지 못했습니다." }
    $version = (Invoke-RestMethod "https://ddragon.leagueoflegends.com/api/versions.json")[0]
    $championData = Invoke-RestMethod "https://ddragon.leagueoflegends.com/cdn/$version/data/en_US/champion.json"
    $champions = @{}; $championData.data.PSObject.Properties | ForEach-Object { $champions[[string]$_.Value.key] = $_.Value.name }
    $participants = @()
    foreach ($identity in $game.participantIdentities) {
        $p = $game.participants | Where-Object participantId -eq $identity.participantId | Select-Object -First 1
        $player = $identity.player; $championName = $champions[[string]$p.championId]; if (-not $championName) { $championName = [string]$p.championId }
        $participants += @{ puuid=[string]$player.puuid; gameName=[string]$(if($player.gameName){$player.gameName}else{$player.summonerName}); tagLine=[string]$player.tagLine; teamId=[int]$p.teamId; win=[bool]$p.stats.win; role=(Get-Role $p); championName=$championName; kills=[int]$p.stats.kills; deaths=[int]$p.stats.deaths; assists=[int]$p.stats.assists; damage=[int]$p.stats.totalDamageDealtToChampions; gold=[int]$p.stats.goldEarned; vision=[int]$p.stats.visionScore; cs=([int]$p.stats.totalMinionsKilled+[int]$p.stats.neutralMinionsKilled) }
    }
    return @{ gameId=[string]$game.gameId; gameCreation=[long]$game.gameCreation; duration=[int]$game.gameDuration; gameMode=[string]$game.gameMode; gameType=[string]$game.gameType; queueId=[int]$game.queueId; participants=$participants }
}

function Send-Match($match) {
    $base = $serverBox.Text.Trim().TrimEnd('/'); $token = $tokenBox.Text.Trim()
    if (-not $base -or -not $token) { throw "웹 서버 주소와 업로드 인증키를 입력해주세요." }
    $script:Config = @{ serverUrl=$base; uploadToken=$token; riotApiKey=$riotKeyBox.Text.Trim() }; $script:Config | ConvertTo-Json | Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    $headers = @{ Authorization = "Bearer $token" }
    $jsonBody = $match | ConvertTo-Json -Depth 8 -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($jsonBody)
    return Invoke-RestMethod -Method Post -Uri "$base/api/internal-matches/upload" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes
}

function Send-RiotKey {
    $base=$serverBox.Text.Trim().TrimEnd('/');$token=$tokenBox.Text.Trim();$riotKey=$riotKeyBox.Text.Trim()
    if(-not $base -or -not $token){throw "웹 서버 주소와 업로드 인증키를 입력해주세요."}
    if($riotKey -notmatch '^RGAPI-[A-Za-z0-9-]{20,}$'){throw "올바른 Riot API 키를 입력해주세요."}
    $headers=@{Authorization="Bearer $token"};$body=@{riotApiKey=$riotKey}|ConvertTo-Json -Compress
    $result=Invoke-RestMethod -Method Post -Uri "$base/api/uploader/riot-key" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $body
    $script:Config=@{serverUrl=$base;uploadToken=$token;riotApiKey=$riotKey};$script:Config|ConvertTo-Json|Set-Content -LiteralPath $script:ConfigPath -Encoding UTF8
    return $result
}

$form = New-Object Windows.Forms.Form
$form.Text = "응CK 내전 업로더"; $form.Size = [Drawing.Size]::new(560,500); $form.StartPosition="CenterScreen"; $form.FormBorderStyle="FixedDialog"; $form.MaximizeBox=$false; $form.BackColor=[Drawing.Color]::FromArgb(247,248,246)
$title = New-Object Windows.Forms.Label; $title.Text="응CK 내전 업로더"; $title.Font=[Drawing.Font]::new("맑은 고딕",18,[Drawing.FontStyle]::Bold); $title.Location=[Drawing.Point]::new(24,20); $title.AutoSize=$true; $form.Controls.Add($title)
$guide = New-Object Windows.Forms.Label; $guide.Text="롤 클라이언트에서 경기 데이터를 읽어 웹 서버로 전송합니다."; $guide.Location=[Drawing.Point]::new(27,61); $guide.Size=[Drawing.Size]::new(500,25); $form.Controls.Add($guide)
function Add-Field($label,$y,$value,$password=$false){$l=New-Object Windows.Forms.Label;$l.Text=$label;$l.Location=[Drawing.Point]::new(28,$y);$l.Size=[Drawing.Size]::new(130,23);$form.Controls.Add($l);$b=New-Object Windows.Forms.TextBox;$b.Location=[Drawing.Point]::new(155,$y-3);$b.Size=[Drawing.Size]::new(360,27);$b.Text=$value;$b.UseSystemPasswordChar=$password;$form.Controls.Add($b);return $b}
$serverBox=Add-Field "웹 서버 주소" 108 $script:Config.serverUrl
$tokenBox=Add-Field "업로드 인증키" 151 $script:Config.uploadToken $true
$riotKeyBox=Add-Field "Riot API 키" 194 $script:Config.riotApiKey $true
$keyButton=New-Object Windows.Forms.Button;$keyButton.Text="API 키 서버에 저장";$keyButton.Location=[Drawing.Point]::new(155,226);$keyButton.Size=[Drawing.Size]::new(360,34);$form.Controls.Add($keyButton)
$gameBox=Add-Field "게임 ID" 285 ""
$sendButton=New-Object Windows.Forms.Button;$sendButton.Text="경기 데이터 전송";$sendButton.Location=[Drawing.Point]::new(28,322);$sendButton.Size=[Drawing.Size]::new(487,48);$sendButton.BackColor=[Drawing.Color]::FromArgb(23,68,57);$sendButton.ForeColor=[Drawing.Color]::White;$sendButton.FlatStyle="Flat";$sendButton.Font=[Drawing.Font]::new("맑은 고딕",11,[Drawing.FontStyle]::Bold);$form.Controls.Add($sendButton)
$status=New-Object Windows.Forms.TextBox;$status.Location=[Drawing.Point]::new(28,386);$status.Size=[Drawing.Size]::new(487,48);$status.Multiline=$true;$status.ReadOnly=$true;$status.BackColor=[Drawing.Color]::White;$status.Text="준비됨 · API 키 저장 또는 경기 데이터 전송을 선택하세요.";$form.Controls.Add($status)
$keyButton.Add_Click({$keyButton.Enabled=$false;$status.Text="Riot API 키를 서버에 저장하는 중입니다...";[Windows.Forms.Application]::DoEvents();try{$null=Send-RiotKey;$status.Text="완료 · 서버의 Riot API 키가 갱신되었습니다."}catch{$status.Text="실패 · $($_.Exception.Message)"}finally{$keyButton.Enabled=$true}})
$sendButton.Add_Click({
    $sendButton.Enabled=$false; $status.Text="게임 기록을 가져오는 중입니다..."; [Windows.Forms.Application]::DoEvents()
    try { $match=Get-InternalMatch $gameBox.Text.Trim(); $status.Text="웹 서버로 전송하는 중입니다..."; [Windows.Forms.Application]::DoEvents(); $result=Send-Match $match; $status.Text="전송 완료 · 게임 $($result.gameId) · 서버 누적 $($result.total)경기"; $gameBox.Clear() }
    catch { $status.Text="실패 · $($_.Exception.Message)" }
    finally { $sendButton.Enabled=$true }
})
$form.AcceptButton=$sendButton
[void]$form.ShowDialog()
