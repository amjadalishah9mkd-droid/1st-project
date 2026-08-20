# 1st Project

A small, dependency-free web application configured for Alloy development sessions.

## Run with Alloy Compose

```sh
docker compose -f docker-compose.alloy.yaml up -d
```

The application listens on port `3000`. In an Alloy session, open the preview at
`http://localhost:8080`.

The service exposes a health check at `http://localhost:3000/health`.
