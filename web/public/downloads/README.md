# Installer release directory

`npm run installer:build` only copies `WorkBuddy-Image-MCP-Setup.exe` here after Authenticode signing and signature verification succeed. The executable is intentionally ignored by Git and must be present before the production web image is built.
