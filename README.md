# Bot Enel - Docker Setup

Este projeto contém dois serviços principais:
1. Servidor principal (porta 3006)
2. Servidor de captcha (porta 3000)

## Requisitos

- Docker
- Docker Compose

## Como executar com Docker

### Construir e iniciar os contêineres

```bash
docker-compose up -d
```

Este comando irá construir as imagens (se necessário) e iniciar os contêineres em modo detached (background).

### Verificar logs

```bash
# Logs do servidor principal
docker logs bot-enel-main -f

# Logs do servidor de captcha
docker logs bot-enel-captcha -f
```

### Parar os contêineres

```bash
docker-compose down
```

### Reconstruir as imagens (após alterações no código)

```bash
docker-compose up -d --build
```

## Acessando os serviços

- Servidor principal: http://localhost:3006
- Servidor de captcha: http://localhost:3000/pending

## Volumes

- Os logs são persistidos no diretório `./logs` do host
- Os dados do Redis são persistidos em um volume Docker

## Variáveis de ambiente

Você pode configurar variáveis de ambiente adicionando-as ao arquivo docker-compose.yml ou criando um arquivo `.env` na raiz do projeto.
