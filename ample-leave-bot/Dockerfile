FROM node:20-alpine

WORKDIR /app

# Install system deps for pdfjs if needed (fonts/libc++)
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Set defaults
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Default to API server. Use different CMD to run Slack bot.
CMD ["npm", "start"]

