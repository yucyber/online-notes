FROM node:20-alpine

WORKDIR /app

# 复制依赖定义文件
COPY package*.json ./

# 安装生产依赖
RUN npm install --production

# 复制源代码 (包括 server.js)
COPY . .

# 设置环境变量
# HOST=0.0.0.0 确保容器外可以访问
ENV HOST=0.0.0.0
ENV PORT=1234

# 暴露端口
EXPOSE 1234

# 启动服务
CMD ["npm", "start"]
