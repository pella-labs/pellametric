// OS service unit templates, inlined as string constants so they survive
// `bun build --compile`. The earlier version read these from
// packaging/{launchd,systemd,windows}/*.tmpl on disk — that works in dev
// (when the binary runs out of the repo) but a compiled binary has no
// access to those files. Sandesh hit this with `ENOENT: no such file or
// directory, open '/packaging/launchd/dev.bematist.collector.plist.tmpl'`
// — import.meta.dir inside bun-compile resolves to an embedded virtual
// path, so the resolve(…, "..", "..", "..", "packaging") walk landed
// outside the binary.
//
// Keep these in sync with the canonical .tmpl files under packaging/ —
// the distro packages (deb, AUR, Chocolatey, Homebrew) also reference
// those files for their post-install hooks, so the on-disk copies stay
// authoritative. This module is strictly for the CLI's in-process
// rendering path (`bematist start`).

/** macOS LaunchAgent — rendered with @HOME@, @BIN@ substituted. */
export const LAUNCHD_PLIST_TMPL = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.bematist.collector</string>

  <!-- Direct exec — NO /bin/sh wrapper. Binary loads ~/.bematist/config.env
       itself via loadConfig() in apps/collector/src/config.ts. Earlier
       versions shelled out via /bin/sh -c "source config.env; exec bematist
       serve"; on Macs running an EDR / Gatekeeper hook that held the sh
       fork in SIGSTOP before exec, the daemon never started (ps STAT=T,
       0-byte logs). Matches SYSTEMD_SERVICE_TMPL ExecStart=@BIN@ serve. -->
  <key>ProgramArguments</key>
  <array>
    <string>@BIN@</string>
    <string>serve</string>
  </array>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>ProcessType</key>
  <string>Background</string>

  <key>StandardOutPath</key>
  <string>@HOME@/.bematist/logs/out.log</string>

  <key>StandardErrorPath</key>
  <string>@HOME@/.bematist/logs/err.log</string>

  <key>WorkingDirectory</key>
  <string>@HOME@/.bematist</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>@HOME@</string>
  </dict>

  <key>SoftResourceLimits</key>
  <dict>
    <key>Core</key>
    <integer>0</integer>
  </dict>

  <key>HardResourceLimits</key>
  <dict>
    <key>Core</key>
    <integer>0</integer>
  </dict>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
`;

/** Linux systemd user unit — rendered with @BIN@ substituted. */
export const SYSTEMD_SERVICE_TMPL = `[Unit]
Description=Bematist collector
Documentation=https://bematist.dev/docs
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=@BIN@ serve
Restart=on-failure
RestartSec=5
LimitCORE=0
EnvironmentFile=-%h/.bematist/config.env
WorkingDirectory=%h/.bematist
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
`;

/** Windows Scheduled Task XML — rendered with @USER@, @BIN@ substituted. */
export const WINDOWS_TASK_XML_TMPL = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>\\Bematist\\Collector</URI>
    <Description>Bematist collector — captures LLM/coding-agent usage and ships it to your configured ingest endpoint.</Description>
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
      <WorkingDirectory>%USERPROFILE%\\.bematist</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

/** Substitute @KEY@ tokens in a template string. Keys are upper-case and
 *  bounded by `@` so normal text never collides. */
export function renderTemplate(tmpl: string, vars: Record<string, string>): string {
  let out = tmpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`@${k}@`, "g"), v);
  }
  return out;
}
