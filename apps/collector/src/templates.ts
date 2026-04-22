// Platform service-unit templates. Kept inline (not loaded from disk)
// so the `bun build --compile` binary is a single self-contained file.
// The on-disk versions under packaging/ are the source of truth for
// reviewing / editing; keep both in sync when either changes.

export const LAUNCHD_PLIST_TMPL = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.pella.collector</string>

  <key>ProgramArguments</key>
  <array>
    <string>@BIN@</string>
    <string>serve</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <!--
    No ProcessType → defaults to Standard. ProcessType=Background makes
    launchd SIGTERM this job with reason="inefficient" under even mild
    system load; KeepAlive restarts it, but every restart pays the full
    cold-start re-parse, so the collector appears to stall.
  -->

  <key>StandardOutPath</key>
  <string>@HOME@/.pella/logs/out.log</string>

  <key>StandardErrorPath</key>
  <string>@HOME@/.pella/logs/err.log</string>

  <key>WorkingDirectory</key>
  <string>@HOME@/.pella</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>@HOME@</string>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;

export const SYSTEMD_SERVICE_TMPL = `[Unit]
Description=pellametric collector
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=@BIN@ serve
Restart=on-failure
RestartSec=5
EnvironmentFile=-%h/.pella/config.env
WorkingDirectory=%h/.pella
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;

export const WINDOWS_TASK_XML_TMPL = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\Pella\\Collector</URI>
    <Description>pellametric collector — captures Claude Code + Codex session data and ships it to your configured ingest endpoint.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <UserId>@USER@</UserId>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>@USER@</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <Hidden>true</Hidden>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <RestartOnFailure>
      <Interval>PT5S</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>@BIN@</Command>
      <Arguments>serve</Arguments>
      <WorkingDirectory>%USERPROFILE%\\.pella</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

/** Substitute @KEY@ placeholders with values. Unknown keys are ignored. */
export function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  let out = tmpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`@${k}@`, v);
  }
  return out;
}
