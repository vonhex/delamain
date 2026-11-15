; Delamain for Windows: the setup program (Inno Setup 6).
;
; Built by .github/workflows/windows-installer.yml for every release:
;   iscc /DAppVersion=2.5.0 windows\delamain.iss   ->  dist-installer\Delamain-Setup-2.5.0.exe
;
; It installs Delamain for the current user (no administrator prompt) into
; %LOCALAPPDATA%\Programs\Delamain, adds Start Menu and desktop shortcuts, and then runs the
; same install.ps1 the zip uses to download Python, PyTorch for this PC's graphics card and his
; voice tools. Those are several GB and differ per machine, so they are fetched at install time
; rather than packed into the setup file. Running a newer setup over an old one updates it and
; keeps your settings, conversations and downloaded models.

#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#define PowerShell "{sys}\WindowsPowerShell\v1.0\powershell.exe"

[Setup]
AppId={{8F3B2C1E-5D4A-4E7B-9C61-DE1A9A1A2025}
AppName=Delamain
AppVersion={#AppVersion}
AppVerName=Delamain {#AppVersion}
AppPublisher=vonhex
AppPublisherURL=https://github.com/vonhex/delamain
AppSupportURL=https://github.com/vonhex/delamain/issues
AppUpdatesURL=https://github.com/vonhex/delamain/releases
DefaultDirName={localappdata}\Programs\Delamain
DefaultGroupName=Delamain
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist-installer
OutputBaseFilename=Delamain-Setup-{#AppVersion}
SetupIconFile=delamain.ico
UninstallDisplayIcon={app}\windows\delamain.ico
UninstallDisplayName=Delamain
LicenseFile=..\LICENSE
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
; A running Delamain holds his files open; setup offers to close him before updating.
CloseApplications=yes

[Messages]
WelcomeLabel2=This will install Delamain, a voice companion for the drive, on your computer.%n%nAfter the files are copied, setup downloads the rest of what he needs (Python, the AI voice tools and the right PyTorch for your graphics card). That is several GB and can take 10 to 30 minutes, so a good internet connection helps.%n%nYou also need an AI model for the conversation, such as Ollama or LM Studio; the README explains how.

[Tasks]
Name: desktopicon; Description: "Create a &desktop shortcut"; GroupDescription: "Shortcuts:"
Name: installdeps; Description: "&Download and set up everything he needs now (recommended; otherwise it happens on first start)"; GroupDescription: "Setup:"

[Files]
; Everything in the release except what each PC makes for itself. (A folder name excludes the
; whole folder; "folder\*" would only skip the files directly inside it.) Your own data
; (settings.json, delamain.db, .env, downloaded models and clips) is never in the setup file,
; so an update can't overwrite it.
Source: "..\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "\.git,\.github,\frontend\node_modules,\venv,\checkpoints,\audio_output,\line_clips,\dist-installer,__pycache__,*.pyc,\.env,*.db,*.sqlite,\settings.json,*.wav,\windows\*.iss"
; The reference voice he is cloned from is the one .wav that ships.
Source: "..\delamain_ref_10s.wav"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Delamain"; Filename: "{#PowerShell}"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\launch.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\windows\delamain.ico"; Comment: "Start Delamain and open him in your browser"
Name: "{group}\Uninstall Delamain"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Delamain"; Filename: "{#PowerShell}"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\launch.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\windows\delamain.ico"; Comment: "Start Delamain and open him in your browser"; \
  Tasks: desktopicon

[Run]
Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\first-setup.ps1"""; \
  WorkingDir: "{app}"; StatusMsg: "Setting up Delamain: downloading Python, PyTorch and his voice tools. This can take 10 to 30 minutes..."; \
  Tasks: installdeps; Flags: waituntilterminated
Filename: "{#PowerShell}"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\windows\launch.ps1"""; \
  WorkingDir: "{app}"; Description: "Start Delamain now"; Flags: postinstall nowait skipifsilent

[UninstallDelete]
; What setup and Delamain downloaded or built on this PC. Your settings and conversation
; history (settings.json, delamain.db) are left in the folder; delete it to remove them too.
Type: filesandordirs; Name: "{app}\venv"
Type: filesandordirs; Name: "{app}\checkpoints"
Type: filesandordirs; Name: "{app}\frontend\node_modules"
Type: filesandordirs; Name: "{app}\frontend\dist"
Type: filesandordirs; Name: "{app}\audio_output"
Type: filesandordirs; Name: "{app}\line_clips"
Type: filesandordirs; Name: "{app}\__pycache__"
