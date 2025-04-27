#!/bin/bash

# Iniciar o servidor X virtual
Xvfb :99 -screen 0 1280x1024x24 &
export DISPLAY=:99

# Aguardar o servidor X iniciar
sleep 1

# Executar o comando fornecido
exec "$@"
