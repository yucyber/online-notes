import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/modules/ai/ai.service';
import { Note } from '../src/modules/notes/schemas/note.schema';
import { Model } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const noteModel = app.get<Model<Note>>(getModelToken(Note.name));
    const aiService = app.get(AiService);

    console.log('Finding notes to summarize...');
    // Process all notes to ensure AI summary is generated (covering previously fallback-only ones)
    const notes = await noteModel.find({}).exec();
    console.log(`Found ${notes.length} notes.`);

    for (const note of notes) {
        console.log(`Processing note: ${note._id}`);
        try {
            // 1. Generate fallback
            const cleanContent = note.content
                .replace(/<[^>]+>/g, '')
                .replace(/[#*`_~>\[\]()]/g, '')
                .trim();
            const fallbackSummary = cleanContent.substring(0, 200) + (cleanContent.length > 200 ? '...' : '');

            // Update fallback first
            await noteModel.updateOne({ _id: note._id }, { summary: fallbackSummary });

            // 2. Generate AI summary
            const aiSummary = await aiService.generateSummary(note.content);
            if (aiSummary) {
                await noteModel.updateOne({ _id: note._id }, { summary: aiSummary });
                console.log(`Updated summary for ${note._id}`);
            }
        } catch (error) {
            console.error(`Error processing note ${note._id}:`, error);
        }
        // Sleep to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await app.close();
    process.exit(0);
}

bootstrap();
