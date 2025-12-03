export const getMongoConfig = async () => ({
  uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/notes',
});

export const getJwtConfig = () => ({
  secret: process.env.JWT_SECRET,
  signOptions: {
    expiresIn: '7d',
  },
});
