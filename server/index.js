const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'brightspace';
const collectionName = process.env.MONGODB_COLLECTION || 'vectors';
const vectorIndex = process.env.VECTOR_INDEX_NAME || 'vector_index';
const apiKey = process.env.API_KEY || '';

if (!mongoUri) {
  console.error('MONGODB_URI is required');
  process.exit(1);
}

app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.use((req, res, next) => {
  if (!apiKey) {
    return next();
  }
  const headerKey = req.get('x-api-key');
  if (headerKey !== apiKey) {
    return res.status(401).json({ error: 'Invalid API key' });
  }
  return next();
});

let collection;

async function connectMongo() {
  const client = new MongoClient(mongoUri, { maxPoolSize: 10 });
  await client.connect();
  collection = client.db(dbName).collection(collectionName);
  console.log('Connected to MongoDB');
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/vectors/upsert', async (req, res) => {
  try {
    const documents = Array.isArray(req.body?.documents) ? req.body.documents : [];
    if (documents.length === 0) {
      return res.status(400).json({ error: 'No documents provided' });
    }

    const ops = documents.map((doc) => ({
      updateOne: {
        filter: { fileId: doc.fileId, chunkId: doc.chunkId },
        update: {
          $set: {
            fileId: doc.fileId,
            fileName: doc.fileName,
            chunkId: doc.chunkId,
            text: doc.text,
            embedding: doc.embedding,
            updatedAt: new Date()
          }
        },
        upsert: true
      }
    }));

    const result = await collection.bulkWrite(ops, { ordered: false });
    return res.json({ success: true, result });
  } catch (error) {
    console.error('Vector upsert error:', error);
    return res.status(500).json({ error: error.message || 'Upsert failed' });
  }
});

app.post('/api/vectors/query', async (req, res) => {
  try {
    const embedding = req.body?.embedding;
    const topK = Math.max(1, Math.min(Number(req.body?.topK) || 8, 50));
    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(400).json({ error: 'Embedding is required' });
    }

    const pipeline = [
      {
        $vectorSearch: {
          index: vectorIndex,
          path: 'embedding',
          queryVector: embedding,
          numCandidates: Math.max(topK * 10, 50),
          limit: topK
        }
      },
      {
        $project: {
          fileId: 1,
          fileName: 1,
          chunkId: 1,
          text: 1,
          score: { $meta: 'vectorSearchScore' }
        }
      }
    ];

    const results = await collection.aggregate(pipeline).toArray();
    return res.json({ results });
  } catch (error) {
    console.error('Vector query error:', error);
    return res.status(500).json({ error: error.message || 'Query failed' });
  }
});

connectMongo()
  .then(() => {
    app.listen(port, () => {
      console.log(`Vector API listening on port ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to connect to MongoDB:', error);
    process.exit(1);
  });
