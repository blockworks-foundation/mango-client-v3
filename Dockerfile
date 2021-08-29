FROM node:16 AS v3-ts

# install dependencies
COPY package.json package.json
COPY yarn.lock yarn.lock
RUN yarn install --ignore-scripts

# build typescript code
COPY src src
COPY test test
COPY tsconfig.json tsconfig.json
RUN yarn build

FROM node:16 AS v3-liq

COPY --from=v3-ts node_modules node_modules
COPY --from=v3-ts lib/src src

CMD node src/liquidator.js