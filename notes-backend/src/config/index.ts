export const getMongoConfig = async () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/notes',
});

export const getJwtConfig = () => ({
  secret: process.env.JWT_SECRET || 'super-secret-jwt-key',
  signOptions: {
    expiresIn: '7d',
  },
});