FROM node:lts-alpine3.24 AS base

# The preview compiles LaTeX in this image (src/latex.ts). Only the collections the generated preamble
# loads are installed; texlive-most is deliberately absent.
RUN apk add --no-cache texlive texmf-dist-latexrecommended texmf-dist-latexextra texmf-dist-fontsrecommended \
    && rm -rf /usr/share/texmf-dist/doc /usr/share/texmf-dist/source \
    && mktexlsr

WORKDIR /app

COPY --chown=node:node package*.json ./

RUN chown node:node /app

USER node

FROM base AS dev

RUN npm ci

COPY --chown=node:node . .

EXPOSE 4100

CMD ["npm", "run", "dev"]

FROM base AS builder

RUN npm ci

COPY --chown=node:node . .

RUN npm run build

FROM base AS prod

ENV NODE_ENV=production

RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 4100

CMD ["node", "dist/serve.js"]
