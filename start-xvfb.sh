#!/bin/bash

# Iniciar o servidor X virtual com mais opções
Xvfb :99 -screen 0 1280x1024x24 -ac +extension GLX +render -noreset &
export DISPLAY=:99

# Aguardar o servidor X iniciar
sleep 2

# Verificar se o servidor X está rodando
if ! xdpyinfo -display :99 >/dev/null 2>&1; then
    echo "Erro: Servidor X não iniciou corretamente!"
    exit 1
fi

# Iniciar o dbus
mkdir -p /var/run/dbus
dbus-daemon --system --fork
sleep 1

# Configurar ambiente para o Chromium
export DBUS_SESSION_BUS_ADDRESS=unix:path=/var/run/dbus/system_bus_socket

# Imprimir informações de debug
echo "Display: $DISPLAY"
echo "D-Bus: $DBUS_SESSION_BUS_ADDRESS"

# Executar o comando fornecido
exec "$@"
