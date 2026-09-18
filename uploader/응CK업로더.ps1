Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:ServerUrl = "https://lol-ck.vercel.app"
$script:MatchUploadToken = "__MATCH_UPLOAD_TOKEN__"

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

function Test-ObjectProperty($value, [string]$name) {
    return $null -ne $value -and $null -ne $value.PSObject.Properties[$name]
}

function ConvertTo-TimelinePosition($position) {
    if ($null -eq $position) { return $null }
    $result = @{}
    if (Test-ObjectProperty $position "x") { $result.x = [int]$position.x }
    if (Test-ObjectProperty $position "y") { $result.y = [int]$position.y }
    if ($result.Count -eq 0) { return $null }
    return $result
}

function ConvertTo-CompactTimeline($sourceTimeline) {
    $compactFrames = @()
    $compactEvents = @()
    $allowedEventTypes = @("CHAMPION_KILL", "BUILDING_KILL", "ELITE_MONSTER_KILL")

    foreach ($frame in @($sourceTimeline.frames)) {
        $participantFrames = @()
        if ($frame.participantFrames) {
            foreach ($property in @($frame.participantFrames.PSObject.Properties)) {
                $source = $property.Value
                if ($null -eq $source) { continue }
                $participantId = if (Test-ObjectProperty $source "participantId") { [int]$source.participantId } else { [int]$property.Name }
                $participantFrame = @{
                    participantId = $participantId
                    currentGold = [int]$source.currentGold
                    totalGold = [int]$source.totalGold
                    xp = [int]$source.xp
                    level = [int]$source.level
                    minionsKilled = [int]$source.minionsKilled
                    jungleMinionsKilled = [int]$source.jungleMinionsKilled
                    teamScore = [int]$source.teamScore
                }
                $position = ConvertTo-TimelinePosition $source.position
                if ($null -ne $position) { $participantFrame.position = $position }
                $participantFrames += $participantFrame
            }
        }

        $compactFrames += @{
            timestamp = [long]$frame.timestamp
            participantFrames = $participantFrames
        }

        foreach ($event in @($frame.events)) {
            $eventType = [string]$event.type
            if ($allowedEventTypes -notcontains $eventType) { continue }
            $compactEvent = @{
                timestamp = [long]$event.timestamp
                type = $eventType
            }

            foreach ($field in @("killerId", "victimId", "teamId", "killerTeamId", "bounty", "shutdownBounty", "killStreakLength", "multiKillLength")) {
                if (Test-ObjectProperty $event $field) { $compactEvent[$field] = [int]$event.$field }
            }
            foreach ($field in @("buildingType", "towerType", "laneType", "monsterType", "monsterSubType")) {
                if (Test-ObjectProperty $event $field) { $compactEvent[$field] = [string]$event.$field }
            }
            if (Test-ObjectProperty $event "assistingParticipantIds") {
                $compactEvent.assistingParticipantIds = @($event.assistingParticipantIds | ForEach-Object { [int]$_ })
            }
            $position = ConvertTo-TimelinePosition $event.position
            if ($null -ne $position) { $compactEvent.position = $position }
            $compactEvents += $compactEvent
        }
    }

    $result = @{ frames = $compactFrames; events = $compactEvents }
    if (Test-ObjectProperty $sourceTimeline "frameInterval") { $result.frameInterval = [long]$sourceTimeline.frameInterval }
    return $result
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
    $soloKills=@{}; $soloDeaths=@{}; $epicObjectives=@(); $timelineCollected=$false; $timelineSource=""; $timelineError=""; $compactTimeline=$null
    $timelineFile=Join-Path ([IO.Path]::GetTempPath()) ("eungck-timeline-"+[guid]::NewGuid().ToString("N")+".json")
    try {
        & curl.exe -s -k -u "riot:$($auth.Token)" --output $timelineFile "https://127.0.0.1:$($auth.Port)/lol-match-history/v1/game-timelines/$gameId"
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $timelineFile)) { throw "LCU 타임라인 요청에 실패했습니다." }
        $timelineRaw = [IO.File]::ReadAllText($timelineFile, [Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($timelineRaw)) { throw "LCU 타임라인이 비어 있습니다." }
        $timeline = $timelineRaw | ConvertFrom-Json
        if ($timeline.httpStatus -or -not $timeline.frames) { throw "LCU 타임라인이 비어 있습니다." }

        $identityById=@{}; $participantById=@{}
        foreach($identity in @($game.participantIdentities)){$identityById[[string]$identity.participantId]=$identity.player}
        foreach($participant in @($game.participants)){$participantById[[string]$participant.participantId]=$participant}
        foreach($frame in @($timeline.frames)){foreach($event in @($frame.events)){
            if($event.type -eq "CHAMPION_KILL" -and @($event.assistingParticipantIds).Count -eq 0){$killer=[string]$event.killerId;$victim=[string]$event.victimId;if([int]$event.killerId -gt 0){$soloKills[$killer]=1+[int]$soloKills[$killer]};if([int]$event.victimId -gt 0){$soloDeaths[$victim]=1+[int]$soloDeaths[$victim]}}
            if($event.type -eq "ELITE_MONSTER_KILL"){$killerId=[string]$event.killerId;$killerPlayer=$identityById[$killerId];$killerParticipant=$participantById[$killerId];$assistPuuids=@(@($event.assistingParticipantIds)|ForEach-Object{[string]$identityById[[string]$_].puuid}|Where-Object{$_});$epicObjectives+=@{timestamp=[long]$event.timestamp;monsterType=[string]$event.monsterType;monsterSubType=[string]$event.monsterSubType;teamId=[int]$(if($event.killerTeamId){$event.killerTeamId}elseif($event.teamId){$event.teamId}elseif($killerParticipant){$killerParticipant.teamId}else{0});killerPuuid=[string]$killerPlayer.puuid;assistingPuuids=$assistPuuids}}
        }}
        $compactTimeline = ConvertTo-CompactTimeline $timeline
        $timelineCollected=$true; $timelineSource="LCU"
    }
    catch {
        $timelineError=$_.Exception.Message
        $compactTimeline=$null
    }
    finally {
        if(Test-Path -LiteralPath $timelineFile){Remove-Item -LiteralPath $timelineFile -Force -ErrorAction SilentlyContinue}
    }
    $version = (Invoke-RestMethod "https://ddragon.leagueoflegends.com/api/versions.json")[0]
    $championData = Invoke-RestMethod "https://ddragon.leagueoflegends.com/cdn/$version/data/en_US/champion.json"
    $champions = @{}; $championData.data.PSObject.Properties | ForEach-Object { $champions[[string]$_.Value.key] = $_.Value.name }
    $participants = @()
    foreach ($identity in $game.participantIdentities) {
        $p = $game.participants | Where-Object participantId -eq $identity.participantId | Select-Object -First 1
        $player = $identity.player; $championName = $champions[[string]$p.championId]; if (-not $championName) { $championName = [string]$p.championId }
        $participants += @{ participantId=[int]$p.participantId; puuid=[string]$player.puuid; gameName=[string]$(if($player.gameName){$player.gameName}else{$player.summonerName}); tagLine=[string]$player.tagLine; teamId=[int]$p.teamId; win=[bool]$p.stats.win; role=(Get-Role $p); championName=$championName; kills=[int]$p.stats.kills; deaths=[int]$p.stats.deaths; assists=[int]$p.stats.assists; damage=[int]$p.stats.totalDamageDealtToChampions; gold=[int]$p.stats.goldEarned; vision=[int]$p.stats.visionScore; cs=([int]$p.stats.totalMinionsKilled+[int]$p.stats.neutralMinionsKilled); damageTaken=[int]$p.stats.totalDamageTaken; mitigated=[int]$p.stats.damageSelfMitigated; turretDamage=[int]$p.stats.damageDealtToTurrets; objectiveDamage=[int]$p.stats.damageDealtToObjectives; healing=[int]$p.stats.totalHeal; unitsHealed=[int]$p.stats.totalUnitsHealed; healsOnTeammates=[int]$p.stats.totalHealsOnTeammates; shieldsOnTeammates=[int]$p.stats.totalDamageShieldedOnTeammates; ccTime=[int]$p.stats.timeCCingOthers; totalCcTime=[int]$p.stats.totalTimeCrowdControlDealt; wardsPlaced=[int]$p.stats.wardsPlaced; wardsKilled=[int]$p.stats.wardsKilled; controlWards=[int]$p.stats.visionWardsBoughtInGame; turretKills=[int]$p.stats.turretKills; inhibitorKills=[int]$p.stats.inhibitorKills; objectivesStolen=[int]$p.stats.objectivesStolen; objectivesStolenAssists=[int]$p.stats.objectivesStolenAssists; soloKills=[int]$soloKills[[string]$p.participantId]; soloDeaths=[int]$soloDeaths[[string]$p.participantId]; tripleKills=[int]$p.stats.tripleKills; quadraKills=[int]$p.stats.quadraKills; pentaKills=[int]$p.stats.pentaKills }
    }
    return @{ gameId=[string]$game.gameId; gameCreation=[long]$game.gameCreation; duration=[int]$game.gameDuration; gameMode=[string]$game.gameMode; gameType=[string]$game.gameType; queueId=[int]$game.queueId; timelineCollected=$timelineCollected; timelineSource=$timelineSource; timelineError=$timelineError; timeline=$compactTimeline; epicObjectives=$epicObjectives; participants=$participants }
}

function Send-Match($match) {
    $base = $script:ServerUrl.Trim().TrimEnd('/'); $token = $script:MatchUploadToken.Trim()
    if (-not $base -or $token -notmatch '^[a-f0-9]{64}$') { throw "배포용 업로더의 서버 인증 설정을 읽지 못했습니다." }
    $headers = @{ Authorization = "Bearer $token" }
    $jsonBody = $match | ConvertTo-Json -Depth 8 -Compress
    $bodyBytes = [Text.Encoding]::UTF8.GetBytes($jsonBody)
    return Invoke-RestMethod -Method Post -Uri "$base/api/internal-matches/upload" -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bodyBytes
}

$form = New-Object Windows.Forms.Form
$form.Text = "응CK 내전 업로더"; $form.Size = [Drawing.Size]::new(560,330); $form.StartPosition="CenterScreen"; $form.FormBorderStyle="FixedDialog"; $form.MaximizeBox=$false; $form.BackColor=[Drawing.Color]::FromArgb(247,248,246)
$title = New-Object Windows.Forms.Label; $title.Text="응CK 내전 업로더"; $title.Font=[Drawing.Font]::new("맑은 고딕",18,[Drawing.FontStyle]::Bold); $title.Location=[Drawing.Point]::new(24,20); $title.AutoSize=$true; $form.Controls.Add($title)
$guide = New-Object Windows.Forms.Label; $guide.Text="롤 클라이언트를 켠 상태에서 게임 ID만 입력하세요."; $guide.Location=[Drawing.Point]::new(27,61); $guide.Size=[Drawing.Size]::new(500,25); $form.Controls.Add($guide)
function Add-Field($label,$y,$value,$password=$false){$l=New-Object Windows.Forms.Label;$l.Text=$label;$l.Location=[Drawing.Point]::new(28,$y);$l.Size=[Drawing.Size]::new(130,23);$form.Controls.Add($l);$b=New-Object Windows.Forms.TextBox;$b.Location=[Drawing.Point]::new(155,$y-3);$b.Size=[Drawing.Size]::new(360,27);$b.Text=$value;$b.UseSystemPasswordChar=$password;$form.Controls.Add($b);return $b}
$gameBox=Add-Field "게임 ID" 112 ""
$sendButton=New-Object Windows.Forms.Button;$sendButton.Text="경기 데이터 전송";$sendButton.Location=[Drawing.Point]::new(28,150);$sendButton.Size=[Drawing.Size]::new(487,48);$sendButton.BackColor=[Drawing.Color]::FromArgb(23,68,57);$sendButton.ForeColor=[Drawing.Color]::White;$sendButton.FlatStyle="Flat";$sendButton.Font=[Drawing.Font]::new("맑은 고딕",11,[Drawing.FontStyle]::Bold);$form.Controls.Add($sendButton)
$status=New-Object Windows.Forms.TextBox;$status.Location=[Drawing.Point]::new(28,214);$status.Size=[Drawing.Size]::new(487,48);$status.Multiline=$true;$status.ReadOnly=$true;$status.BackColor=[Drawing.Color]::White;$status.Text="준비됨 · 게임 ID를 입력한 뒤 전송 버튼을 누르세요.";$form.Controls.Add($status)
$sendButton.Add_Click({
    $sendButton.Enabled=$false; $status.Text="게임 기록을 가져오는 중입니다..."; [Windows.Forms.Application]::DoEvents()
    try { $match=Get-InternalMatch $gameBox.Text.Trim(); $status.Text="웹 서버로 전송하는 중입니다..."; [Windows.Forms.Application]::DoEvents(); $result=Send-Match $match; $status.Text="전송 완료 · 게임 $($result.gameId) · 서버 누적 $($result.total)경기"; $gameBox.Clear() }
    catch { $status.Text="실패 · $($_.Exception.Message)" }
    finally { $sendButton.Enabled=$true }
})
$form.AcceptButton=$sendButton
[void]$form.ShowDialog()
