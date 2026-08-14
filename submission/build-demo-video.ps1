<#
.SYNOPSIS
Builds the 92-second Fluent Me narrated tour from six real session captures.

.DESCRIPTION
The script intentionally has no placeholder or synthetic-screen fallback. It fails
before creating build artifacts unless every required still capture is present and
readable:

  media/entry.png
  media/setup.png
  media/coach-live.png
  media/feedback.png
  media/recap.png
  media/report.png

When media/live-sequence/frame-0001.png and later consecutive frames exist, the
coach-live chapter uses that real motion sequence once at its recorded 5.374 fps,
then holds the final frame to preserve the 92-second editorial timeline. File
payloads are signature-checked because browser capture tooling may save JPEG bytes
with a .png extension. Without the sequence, coach-live.png remains the fallback.

It uses Windows System.Speech for English narration and ffmpeg for timing, motion,
burned-in captions, H.264/AAC encoding, and the poster frame. The final outputs are:

  media/fluent-me-demo.mp4
  media/fluent-me-demo-narration.wav
  media/fluent-me-demo-captions.ass
  media/fluent-me-demo-captions.vtt
  media/fluent-me-demo-transcript.txt
  media/fluent-me-demo-poster.png

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\submission\build-demo-video.ps1 -ValidateOnly

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\submission\build-demo-video.ps1
#>

[CmdletBinding()]
param(
  [ValidateRange(-10, 10)]
  [int]$SpeechRate = -1,

  [ValidateNotNullOrEmpty()]
  [string]$VoiceName = "Microsoft David Desktop",

  # Directory of pre-synthesized narration chapters named "<key>-raw.wav"
  # (24 kHz 16-bit mono PCM), e.g. produced by synthesize-narration.py with an
  # ElevenLabs voice clone. When set, System.Speech is not used at all; the
  # per-chapter atempo fitting still guarantees the editorial durations.
  [string]$PrebuiltVoiceDir = "",

  # Write the chapter narration (key, seconds, text) as JSON to this path and
  # exit. This is the single source of truth handed to an external synthesizer.
  [string]$ExportNarration = "",

  [switch]$ValidateOnly,

  [switch]$KeepBuildArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$scriptRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$mediaDir = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot "media"))
$workDir = [System.IO.Path]::GetFullPath((Join-Path $mediaDir ".demo-build"))
$liveSequenceDir = [System.IO.Path]::GetFullPath((Join-Path $mediaDir "live-sequence"))
$liveSequenceFps = 5.374
$outputVideo = Join-Path $mediaDir "fluent-me-demo.mp4"
$outputNarration = Join-Path $mediaDir "fluent-me-demo-narration.wav"
$outputCaptions = Join-Path $mediaDir "fluent-me-demo-captions.ass"
$outputCaptionsVtt = Join-Path $mediaDir "fluent-me-demo-captions.vtt"
$outputTranscript = Join-Path $mediaDir "fluent-me-demo-transcript.txt"
$outputPoster = Join-Path $mediaDir "fluent-me-demo-poster.png"

# These durations are part of the editorial contract. They total 92 seconds, which
# keeps the finished demo inside the requested 80-100 second window.
$chapters = @(
  [pscustomobject]@{
    Key = "entry"
    Image = "entry.png"
    Seconds = 10.0
    Title = "01  START WITH ONE ACTION"
    Captions = @(
      "Fluent Me is a conversation-first English coach built on Tavus.",
      "This narrated tour uses real session captures to show one focused loop."
    )
  },
  [pscustomobject]@{
    Key = "setup"
    Image = "setup.png"
    Seconds = 12.0
    Title = "02  CONTINUE TO START THE ROOM"
    Captions = @(
      "A Tavus room starts only after the learner selects Continue.",
      "Topic and time box stay optional, and the coach itself can be created from your own face and voice."
    )
  },
  [pscustomobject]@{
    Key = "coach-live"
    Image = "coach-live.png"
    Seconds = 23.0
    Title = "03  CAPTURE THE TAVUS ROOM"
    Captions = @(
      "This is a live Tavus conversation, captured while the coach was responding: Phoenix renders the Face, Sparrow keeps the turns natural, and detailed tools wait in a drawer.",
      "The end state is immersion: talking with yourself, in your own face and your own cloned voice, so imitation collapses into repetition.",
      "The sequence shows visible coach motion in that interval, not learner-audio transport."
    )
  },
  [pscustomobject]@{
    Key = "feedback"
    Image = "feedback.png"
    Seconds = 16.0
    Title = "04  READ THE TAVUS TRANSCRIPT"
    Captions = @(
      "After a captured turn, Feedback shows only evidence that exists:",
      "the Tavus transcript, timing, counted pauses or repeats, and available microphone or Raven signals.",
      "None of it becomes an opaque English score."
    )
  },
  [pscustomobject]@{
    Key = "recap"
    Image = "recap.png"
    Seconds = 17.0
    Title = "05  GROUND ONE USEFUL CHANGE"
    Captions = @(
      "The grounded review turns available evidence into one useful change.",
      "Grammar and wording stay separate from pace and rhythm observations.",
      "A phrase worth keeping moves to spaced review, and missing evidence stays hidden rather than guessed."
    )
  },
  [pscustomobject]@{
    Key = "report"
    Image = "report.png"
    Seconds = 14.0
    Title = "06  DOCUMENT THE BOUNDARIES"
    Captions = @(
      "History is opt-in and stored on this device.",
      "A session also survives its video room: after a provider time cap, the client reconnects and the coach continues the same conversation.",
      "The captured motion does not prove learner audio transport or remote-room cleanup."
    )
  }
)

function Format-InvariantNumber {
  param([double]$Value, [string]$Pattern = "0.###")
  return $Value.ToString($Pattern, [System.Globalization.CultureInfo]::InvariantCulture)
}

function Assert-ChildPath {
  param([string]$Child, [string]$Parent)
  $resolvedChild = [System.IO.Path]::GetFullPath($Child)
  $resolvedParent = [System.IO.Path]::GetFullPath($Parent).TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolvedChild.StartsWith($resolvedParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify a path outside the demo media directory: $resolvedChild"
  }
}

function Invoke-External {
  param(
    [string]$Executable,
    [string[]]$Arguments,
    [string]$Description
  )
  Write-Host "[demo] $Description"
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Get-MediaDuration {
  param([string]$FfprobePath, [string]$Path)
  $raw = & $FfprobePath -v error -show_entries format=duration -of "default=noprint_wrappers=1:nokey=1" $Path
  if ($LASTEXITCODE -ne 0 -or -not $raw) {
    throw "Could not read media duration: $Path"
  }
  $value = 0.0
  if (-not [double]::TryParse(($raw | Select-Object -First 1), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$value)) {
    throw "ffprobe returned an invalid duration for ${Path}: $raw"
  }
  return $value
}

function Get-ImagePayloadCodec {
  param([string]$Path)
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $header = [byte[]]::new(8)
    $read = $stream.Read($header, 0, $header.Length)
    if ($read -ge 8 -and
      $header[0] -eq 0x89 -and $header[1] -eq 0x50 -and $header[2] -eq 0x4E -and $header[3] -eq 0x47 -and
      $header[4] -eq 0x0D -and $header[5] -eq 0x0A -and $header[6] -eq 0x1A -and $header[7] -eq 0x0A) {
      return "png"
    }
    if ($read -ge 3 -and $header[0] -eq 0xFF -and $header[1] -eq 0xD8 -and $header[2] -eq 0xFF) {
      return "mjpeg"
    }
  } finally {
    $stream.Dispose()
  }
  throw "Unsupported image payload in motion frame: $Path"
}

function ConvertTo-AssTime {
  param([double]$Seconds)
  $centiseconds = [int][Math]::Round([Math]::Max(0, $Seconds) * 100)
  $hours = [Math]::Floor($centiseconds / 360000)
  $centiseconds %= 360000
  $minutes = [Math]::Floor($centiseconds / 6000)
  $centiseconds %= 6000
  $wholeSeconds = [Math]::Floor($centiseconds / 100)
  $hundredths = $centiseconds % 100
  return "{0}:{1:00}:{2:00}.{3:00}" -f $hours, $minutes, $wholeSeconds, $hundredths
}

function ConvertTo-AssText {
  param([string]$Text)
  return $Text.Replace("\", "\\").Replace("{", "\{").Replace("}", "\}").Replace("`r", "").Replace("`n", "\N")
}

function ConvertTo-VttTime {
  param([double]$Seconds)
  $milliseconds = [int][Math]::Round([Math]::Max(0, $Seconds) * 1000)
  $hours = [Math]::Floor($milliseconds / 3600000)
  $milliseconds %= 3600000
  $minutes = [Math]::Floor($milliseconds / 60000)
  $milliseconds %= 60000
  $wholeSeconds = [Math]::Floor($milliseconds / 1000)
  $millis = $milliseconds % 1000
  return "{0:00}:{1:00}:{2:00}.{3:000}" -f $hours, $minutes, $wholeSeconds, $millis
}

function Write-Utf8NoBom {
  param([string]$Path, [string[]]$Lines)
  [System.IO.File]::WriteAllLines($Path, $Lines, [System.Text.UTF8Encoding]::new($false))
}

function Write-AssCaptions {
  param([string]$Path, [object[]]$ChapterList)
  $lines = [System.Collections.Generic.List[string]]::new()
  @(
    "[Script Info]",
    "Title: Fluent Me 92-second demo",
    "ScriptType: v4.00+",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "ScaledBorderAndShadow: yes",
    "WrapStyle: 2",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Caption,Segoe UI,40,&H00F5F6F8,&H00F5F6F8,&H7005080D,&HA005080D,0,0,0,0,100,100,0,0,3,1,0,2,170,170,58,1",
    "Style: Chapter,Segoe UI Semibold,31,&H00B0DC43,&H00B0DC43,&H9005080D,&H00000000,-1,0,0,0,100,100,1,0,1,2,0,7,72,72,58,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
  ) | ForEach-Object { $lines.Add($_) }

  $chapterStart = 0.0
  foreach ($chapter in $ChapterList) {
    $chapterEnd = $chapterStart + [double]$chapter.Seconds
    $titleEnd = [Math]::Min($chapterEnd, $chapterStart + 3.2)
    $lines.Add("Dialogue: 1,$(ConvertTo-AssTime $chapterStart),$(ConvertTo-AssTime $titleEnd),Chapter,,0,0,0,,\N$(ConvertTo-AssText $chapter.Title)")

    $captionCount = @($chapter.Captions).Count
    $weights = @($chapter.Captions | ForEach-Object { [Math]::Max(1, $_.Length) })
    $weightTotal = ($weights | Measure-Object -Sum).Sum
    $captionStart = $chapterStart
    for ($index = 0; $index -lt $captionCount; $index += 1) {
      $captionEnd = if ($index -eq $captionCount - 1) {
        $chapterEnd
      } else {
        $captionStart + ([double]$chapter.Seconds * $weights[$index] / $weightTotal)
      }
      $text = ConvertTo-AssText $chapter.Captions[$index]
      $lines.Add("Dialogue: 0,$(ConvertTo-AssTime $captionStart),$(ConvertTo-AssTime $captionEnd),Caption,,0,0,0,,$text")
      $captionStart = $captionEnd
    }
    $chapterStart = $chapterEnd
  }

  Write-Utf8NoBom -Path $Path -Lines $lines.ToArray()
}

function Write-VttCaptions {
  param([string]$Path, [object[]]$ChapterList)
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("WEBVTT")
  $lines.Add("")
  $cueNumber = 1
  $chapterStart = 0.0
  foreach ($chapter in $ChapterList) {
    $chapterEnd = $chapterStart + [double]$chapter.Seconds
    $captionCount = @($chapter.Captions).Count
    $weights = @($chapter.Captions | ForEach-Object { [Math]::Max(1, $_.Length) })
    $weightTotal = ($weights | Measure-Object -Sum).Sum
    $captionStart = $chapterStart
    for ($index = 0; $index -lt $captionCount; $index += 1) {
      $captionEnd = if ($index -eq $captionCount - 1) {
        $chapterEnd
      } else {
        $captionStart + ([double]$chapter.Seconds * $weights[$index] / $weightTotal)
      }
      $lines.Add([string]$cueNumber)
      $lines.Add("$(ConvertTo-VttTime $captionStart) --> $(ConvertTo-VttTime $captionEnd)")
      $lines.Add([string]$chapter.Captions[$index])
      $lines.Add("")
      $cueNumber += 1
      $captionStart = $captionEnd
    }
    $chapterStart = $chapterEnd
  }
  if ($lines.Count -and $lines[$lines.Count - 1] -eq "") { $lines.RemoveAt($lines.Count - 1) }
  Write-Utf8NoBom -Path $Path -Lines $lines.ToArray()
}

function Write-PlainTranscript {
  param([string]$Path, [object[]]$ChapterList)
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("Fluent Me - 92-second narrated tour of real session captures")
  $lines.Add("")
  $lines.Add("This tour uses real session captures, including one short continuous coach-motion sequence. It explains the product path but does not by itself prove learner audio transport or remote-room cleanup.")
  $lines.Add("")
  $chapterStart = 0.0
  foreach ($chapter in $ChapterList) {
    $lines.Add("[$(ConvertTo-VttTime $chapterStart)] $($chapter.Title)")
    foreach ($caption in $chapter.Captions) {
      $lines.Add([string]$caption)
    }
    $lines.Add("")
    $chapterStart += [double]$chapter.Seconds
  }
  if ($lines.Count -and $lines[$lines.Count - 1] -eq "") { $lines.RemoveAt($lines.Count - 1) }
  Write-Utf8NoBom -Path $Path -Lines $lines.ToArray()
}

$totalSeconds = [double](($chapters | Measure-Object -Property Seconds -Sum).Sum)
if ($totalSeconds -lt 80 -or $totalSeconds -gt 100) {
  throw "Editorial timing is $totalSeconds seconds; it must remain between 80 and 100 seconds."
}

if ($ExportNarration) {
  $narrationDoc = [pscustomobject]@{
    total_seconds = $totalSeconds
    chapters = @($chapters | ForEach-Object {
      [pscustomobject]@{
        key = $_.Key
        seconds = $_.Seconds
        text = ($_.Captions -join " ")
      }
    })
  }
  $exportPath = [System.IO.Path]::GetFullPath($ExportNarration)
  [System.IO.File]::WriteAllText($exportPath, ($narrationDoc | ConvertTo-Json -Depth 4), [System.Text.UTF8Encoding]::new($false))
  Write-Host "[demo] Narration exported to $exportPath"
  return
}

$missingImages = @(
  $chapters |
    ForEach-Object { Join-Path $mediaDir $_.Image } |
    Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
)
if ($missingImages.Count -gt 0) {
  $relativeMissing = $missingImages | ForEach-Object { "  - submission/media/$([System.IO.Path]::GetFileName($_))" }
  throw @"
Demo build stopped before synthesis because real product screenshots are missing:
$($relativeMissing -join "`n")

Capture those exact product surfaces from the real build. This script intentionally
does not create placeholder, mocked, or AI-generated product screens.
"@
}

Add-Type -AssemblyName System.Drawing
foreach ($chapter in $chapters) {
  $imagePath = Join-Path $mediaDir $chapter.Image
  $image = $null
  try {
    $image = [System.Drawing.Image]::FromFile($imagePath)
    if ($image.Width -lt 800 -or $image.Height -lt 450) {
      throw "Screenshot $($chapter.Image) is only $($image.Width)x$($image.Height); provide a real capture of at least 800x450."
    }
  } finally {
    if ($null -ne $image) { $image.Dispose() }
  }
}

$liveSequenceFrames = @()
$liveSequenceCodec = $null
if (Test-Path -LiteralPath $liveSequenceDir -PathType Container) {
  $liveSequenceFrames = @(Get-ChildItem -LiteralPath $liveSequenceDir -File -Filter "frame-*.png" | Sort-Object Name)
}
if ($liveSequenceFrames.Count -gt 0) {
  if ($liveSequenceFrames.Count -lt 12) {
    throw "The coach motion sequence has only $($liveSequenceFrames.Count) frames; at least 12 consecutive frames are required."
  }
  for ($index = 0; $index -lt $liveSequenceFrames.Count; $index += 1) {
    $expectedName = "frame-{0:0000}.png" -f ($index + 1)
    if ($liveSequenceFrames[$index].Name -ne $expectedName) {
      throw "Coach motion frames must be consecutive from frame-0001.png. Expected '$expectedName', found '$($liveSequenceFrames[$index].Name)'."
    }
    $frameCodec = Get-ImagePayloadCodec -Path $liveSequenceFrames[$index].FullName
    if ($null -eq $liveSequenceCodec) {
      $liveSequenceCodec = $frameCodec
    } elseif ($frameCodec -ne $liveSequenceCodec) {
      throw "Coach motion frames use mixed image payloads: expected '$liveSequenceCodec', found '$frameCodec' in $($liveSequenceFrames[$index].Name)."
    }
    $frame = $null
    try {
      $frame = [System.Drawing.Image]::FromFile($liveSequenceFrames[$index].FullName)
      if ($frame.Width -lt 800 -or $frame.Height -lt 450) {
        throw "Motion frame $($liveSequenceFrames[$index].Name) is only $($frame.Width)x$($frame.Height); provide a real capture of at least 800x450."
      }
    } finally {
      if ($null -ne $frame) { $frame.Dispose() }
    }
  }
}

$ffmpegCommand = Get-Command ffmpeg -ErrorAction SilentlyContinue
$ffprobeCommand = Get-Command ffprobe -ErrorAction SilentlyContinue
if (-not $ffmpegCommand -or -not $ffprobeCommand) {
  throw "ffmpeg and ffprobe must both be available on PATH."
}
$ffmpegPath = $ffmpegCommand.Source
$ffprobePath = $ffprobeCommand.Source

$filterList = (& $ffmpegPath -hide_banner -filters 2>&1 | Out-String)
foreach ($requiredFilter in @("ass", "atempo", "tpad", "zoompan")) {
  if ($filterList -notmatch "(?m)^ .{2}\s+$([regex]::Escape($requiredFilter))\s") {
    throw "This ffmpeg build is missing the required '$requiredFilter' filter."
  }
}
$encoderList = (& $ffmpegPath -hide_banner -encoders 2>&1 | Out-String)
foreach ($requiredEncoder in @("libx264", "aac")) {
  if ($encoderList -notmatch "\b$([regex]::Escape($requiredEncoder))\b") {
    throw "This ffmpeg build is missing the required '$requiredEncoder' encoder."
  }
}

if ($PrebuiltVoiceDir) {
  $PrebuiltVoiceDir = [System.IO.Path]::GetFullPath($PrebuiltVoiceDir)
  $missingChapterAudio = @(
    $chapters |
      ForEach-Object { Join-Path $PrebuiltVoiceDir "$($_.Key)-raw.wav" } |
      Where-Object { -not (Test-Path -LiteralPath $_ -PathType Leaf) }
  )
  if ($missingChapterAudio.Count -gt 0) {
    throw "PrebuiltVoiceDir is missing chapter narration: $($missingChapterAudio -join ', '). Run synthesize-narration.py first."
  }
} else {
  Add-Type -AssemblyName System.Speech
  $voiceProbe = [System.Speech.Synthesis.SpeechSynthesizer]::new()
  try {
    $englishVoices = @($voiceProbe.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "en-*" } | ForEach-Object { $_.VoiceInfo.Name })
  } finally {
    $voiceProbe.Dispose()
  }
  if ($VoiceName -notin $englishVoices) {
    throw "English System.Speech voice '$VoiceName' is not installed. Available English voices: $($englishVoices -join ', ')"
  }
}

$sequenceStatus = if ($liveSequenceFrames.Count -gt 0) {
  ", $($liveSequenceFrames.Count) consecutive coach-motion frames at $(Format-InvariantNumber $liveSequenceFps '0.000') fps ($liveSequenceCodec payload)"
} else {
  ", no coach-motion sequence (still-image fallback)"
}
Write-Host "[demo] Validation passed: $($chapters.Count) real screenshots$sequenceStatus, $totalSeconds seconds, voice '$VoiceName'."
if ($ValidateOnly) { return }

Assert-ChildPath -Child $workDir -Parent $mediaDir
if (Test-Path -LiteralPath $workDir) {
  Remove-Item -LiteralPath $workDir -Recurse -Force
}
New-Item -ItemType Directory -Path $workDir | Out-Null

$buildSucceeded = $false
try {
  if ($PrebuiltVoiceDir) {
    foreach ($chapter in $chapters) {
      Copy-Item -LiteralPath (Join-Path $PrebuiltVoiceDir "$($chapter.Key)-raw.wav") -Destination (Join-Path $workDir "$($chapter.Key)-raw.wav")
    }
  } else {
    $speechFormat = [System.Speech.AudioFormat.SpeechAudioFormatInfo]::new(
      24000,
      [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,
      [System.Speech.AudioFormat.AudioChannel]::Mono
    )
    $synth = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    try {
      $synth.SelectVoice($VoiceName)
      $synth.Rate = $SpeechRate
      $synth.Volume = 100
      foreach ($chapter in $chapters) {
        $rawWave = Join-Path $workDir "$($chapter.Key)-raw.wav"
        $synth.SetOutputToWaveFile($rawWave, $speechFormat)
        $synth.Speak(($chapter.Captions -join " "))
        $synth.SetOutputToNull()
      }
    } finally {
      $synth.Dispose()
    }
  }

  foreach ($chapter in $chapters) {
    $durationText = Format-InvariantNumber $chapter.Seconds
    $rawWave = Join-Path $workDir "$($chapter.Key)-raw.wav"
    $timedWave = Join-Path $workDir "$($chapter.Key)-voice.wav"
    $rawDuration = Get-MediaDuration -FfprobePath $ffprobePath -Path $rawWave
    $tempo = $rawDuration / [double]$chapter.Seconds
    if ($tempo -gt 2.0) {
      throw "Narration timing for '$($chapter.Key)' requires atempo $(Format-InvariantNumber $tempo), outside the safe range. Shorten its text or lengthen the chapter."
    }
    # Never slow speech down to fill a chapter: stretched narration sounds
    # drugged. Speak at natural pace and let trailing silence carry the rest;
    # only speed up (mildly) when the take overruns its slot.
    $audioFilter = if ($tempo -gt 1.0) {
      "atempo=$(Format-InvariantNumber $tempo '0.000000'),apad,atrim=duration=$durationText,asetpts=N/SR/TB"
    } else {
      "apad,atrim=duration=$durationText,asetpts=N/SR/TB"
    }
    Invoke-External -Executable $ffmpegPath -Description "Time narration chapter $($chapter.Key)" -Arguments @(
      "-hide_banner", "-loglevel", "error", "-y", "-i", $rawWave,
      "-af", $audioFilter, "-ar", "24000", "-ac", "1", "-c:a", "pcm_s16le", $timedWave
    )

    $imagePath = Join-Path $mediaDir $chapter.Image
    $videoClip = Join-Path $workDir "$($chapter.Key).mp4"
    if ($chapter.Key -eq "coach-live" -and $liveSequenceFrames.Count -gt 0) {
      $framePattern = Join-Path $liveSequenceDir "frame-%04d.png"
      $sequenceFpsText = Format-InvariantNumber $liveSequenceFps "0.000"
      $visualFilter = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x090B10,fps=30,tpad=stop_mode=clone:stop_duration=$durationText,trim=duration=$durationText,setpts=PTS-STARTPTS,format=yuv420p"
      Invoke-External -Executable $ffmpegPath -Description "Use $($liveSequenceFrames.Count)-frame real coach-motion sequence" -Arguments @(
        "-hide_banner", "-loglevel", "error", "-y", "-framerate", $sequenceFpsText, "-c:v", $liveSequenceCodec, "-start_number", "1", "-i", $framePattern,
        "-t", $durationText, "-vf", $visualFilter, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p", $videoClip
      )
    } else {
      $visualFilter = "scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x090B10,zoompan=z='min(zoom+0.00010,1.025)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,trim=duration=$durationText,setpts=PTS-STARTPTS,format=yuv420p"
      Invoke-External -Executable $ffmpegPath -Description "Animate real screenshot $($chapter.Image)" -Arguments @(
        "-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-framerate", "30", "-i", $imagePath,
        "-t", $durationText, "-vf", $visualFilter, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-r", "30", "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-pix_fmt", "yuv420p", $videoClip
      )
    }
  }

  $audioList = Join-Path $workDir "audio-concat.txt"
  $videoList = Join-Path $workDir "video-concat.txt"
  Write-Utf8NoBom -Path $audioList -Lines @($chapters | ForEach-Object { "file '$($_.Key)-voice.wav'" })
  Write-Utf8NoBom -Path $videoList -Lines @($chapters | ForEach-Object { "file '$($_.Key).mp4'" })

  $narrationWork = Join-Path $workDir "fluent-me-demo-narration.wav"
  $visualsWork = Join-Path $workDir "fluent-me-demo-visuals.mp4"
  Invoke-External -Executable $ffmpegPath -Description "Join narration chapters" -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", $audioList,
    "-c:a", "pcm_s16le", $narrationWork
  )
  Invoke-External -Executable $ffmpegPath -Description "Join screenshot chapters" -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", $videoList,
    "-c", "copy", $visualsWork
  )

  $captionsWork = Join-Path $workDir "fluent-me-demo-captions.ass"
  Write-AssCaptions -Path $captionsWork -ChapterList $chapters
  $captionsVttWork = Join-Path $workDir "fluent-me-demo-captions.vtt"
  Write-VttCaptions -Path $captionsVttWork -ChapterList $chapters
  $transcriptWork = Join-Path $workDir "fluent-me-demo-transcript.txt"
  Write-PlainTranscript -Path $transcriptWork -ChapterList $chapters
  $videoWork = Join-Path $workDir "fluent-me-demo.mp4"
  $fadeStart = Format-InvariantNumber ($totalSeconds - 0.45)
  $durationLimit = Format-InvariantNumber $totalSeconds

  Push-Location $workDir
  try {
    Invoke-External -Executable $ffmpegPath -Description "Encode captioned Fluent Me demo" -Arguments @(
      "-hide_banner", "-loglevel", "error", "-y", "-i", "fluent-me-demo-visuals.mp4", "-i", "fluent-me-demo-narration.wav",
      "-vf", "ass=fluent-me-demo-captions.ass", "-af", "afade=t=in:st=0:d=0.15,afade=t=out:st=${fadeStart}:d=0.45",
      "-t", $durationLimit, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-c:a", "aac", "-b:a", "192k", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      "-metadata", "title=Fluent Me - narrated tour of real session captures", "fluent-me-demo.mp4"
    )
  } finally {
    Pop-Location
  }

  $finalDuration = Get-MediaDuration -FfprobePath $ffprobePath -Path $videoWork
  if ($finalDuration -lt 80 -or $finalDuration -gt 100) {
    throw "Final video is $(Format-InvariantNumber $finalDuration) seconds; expected 80-100 seconds."
  }

  $posterWork = Join-Path $workDir "fluent-me-demo-poster.png"
  Invoke-External -Executable $ffmpegPath -Description "Create poster from the real coach chapter" -Arguments @(
    "-hide_banner", "-loglevel", "error", "-y", "-ss", "26", "-i", $videoWork,
    "-frames:v", "1", "-vf", "scale=1280:-2:flags=lanczos", $posterWork
  )

  [System.IO.File]::Copy($videoWork, $outputVideo, $true)
  [System.IO.File]::Copy($narrationWork, $outputNarration, $true)
  [System.IO.File]::Copy($captionsWork, $outputCaptions, $true)
  [System.IO.File]::Copy($captionsVttWork, $outputCaptionsVtt, $true)
  [System.IO.File]::Copy($transcriptWork, $outputTranscript, $true)
  [System.IO.File]::Copy($posterWork, $outputPoster, $true)
  $buildSucceeded = $true

  Write-Host "[demo] Built $(Format-InvariantNumber $finalDuration) second video: $outputVideo"
  Write-Host "[demo] Narration: $outputNarration"
  Write-Host "[demo] Burned captions: $outputCaptions"
  Write-Host "[demo] WebVTT captions:  $outputCaptionsVtt"
  Write-Host "[demo] Transcript:       $outputTranscript"
  Write-Host "[demo] Poster:    $outputPoster"
} finally {
  if ($buildSucceeded -and -not $KeepBuildArtifacts -and (Test-Path -LiteralPath $workDir)) {
    Assert-ChildPath -Child $workDir -Parent $mediaDir
    Remove-Item -LiteralPath $workDir -Recurse -Force
  } elseif (-not $buildSucceeded -and (Test-Path -LiteralPath $workDir)) {
    Write-Warning "Build failed. Intermediate files were kept for diagnosis: $workDir"
  }
}
