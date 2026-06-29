# Handoff para Wave/BLACKBOX

Objetivo: publicar a imagem Docker do burn-in PRL no GHCR.

Escopo da Wave:

- Criar/usar repo GitHub para este diretorio.
- Buildar e publicar a imagem.
- Devolver o nome final da imagem.

Fora do escopo da Wave:

- Nao usar `SALAD_API_KEY`.
- Nao criar container group na Salad.
- Nao receber envs privados.

## Caminho recomendado

1. Subir o conteudo deste diretorio para um repo GitHub.
2. Garantir que Actions tenha permissao de `packages: write`.
3. Rodar o workflow `Build Salad PRL Burn-in`.
4. Retornar a imagem:

```text
ghcr.io/<owner>/salad-prl-burnin:0.1.0
```

## Build manual alternativo

```bash
docker build -t ghcr.io/<owner>/salad-prl-burnin:0.1.0 .
docker push ghcr.io/<owner>/salad-prl-burnin:0.1.0
```

## Validacao esperada

```bash
docker run --rm ghcr.io/<owner>/salad-prl-burnin:0.1.0 --help
```

Esse comando deve falhar pedindo `PRL_WALLET`, porque a wallet entra so em runtime na Salad.

