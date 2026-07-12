@echo off
REM Calypso Radio — full first-time deploy. Just double-click me!
cd /d "%~dp0"
echo.
echo  === Deploying Calypso Radio to music.atmosphereengine.com ===
echo.

echo --- Copying app to the server...
ssh root@187.124.235.109 "mkdir -p /opt/calypso-radio/media" || goto :fail
scp server.js package.json package-lock.json .radio_token server-setup.sh root@187.124.235.109:/opt/calypso-radio/ || goto :fail
scp -r public root@187.124.235.109:/opt/calypso-radio/ || goto :fail

echo --- Copying your music...
scp "media\Kind Words Skin.mp3" "media\Velvet Gratitude.wav" root@187.124.235.109:/opt/calypso-radio/media/ || goto :fail

echo --- Setting up the server (npm, pm2, nginx, https)...
ssh root@187.124.235.109 "sed -i 's/\r$//' /opt/calypso-radio/server-setup.sh && bash /opt/calypso-radio/server-setup.sh" || goto :fail

echo.
echo  Deploy finished! The link above (with ?token=...) is your station.
pause
exit /b 0

:fail
echo.
echo  !! Something went wrong — show Claude the message above.
pause
exit /b 1
