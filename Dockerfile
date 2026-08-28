FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY *.html *.css *.js ./
RUN mkdir -p /app/data
ENV PORT=4173 HOST=0.0.0.0 DATA_FILE=/app/data/internal-matches.json
EXPOSE 4173
CMD ["node", "server.mjs"]
