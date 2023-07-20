FROM node:18-alpine as node
ENV NO_UPDATE_NOTIFIER true
WORKDIR /opt

FROM node as base
COPY ./package.json .
COPY ./package-lock.json .
RUN chown -R nobody:nogroup ./ && \
    mkdir /.npm && chown nobody:nogroup /.npm && \
    mkdir -p /opt/log && chown nobody:nogroup /opt/log && \
    ln -sf /dev/stdout /opt/log/stdout.log && \
    ln -sf /dev/stderr /opt/log/stderr.log
USER nobody:nobody
RUN npm ci --omit dev

FROM base as build
RUN npm ci
ADD ./src ./src
COPY ./tsconfig.json .
RUN npm run build

FROM base as release
COPY --from=build /opt/dist ./dist

ENV NODE_ENV=production
ENV DEBUG=app:*

EXPOSE 80

CMD node ./dist/main.js 1>> ./log/stdout.log 2>> ./log/stderr.log
