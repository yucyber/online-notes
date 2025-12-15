import { cookies } from 'next/headers'
import { Note } from '@/types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'

export async function getNoteById(id: string): Promise<Note | null> {
    try {
        const cookieStore = await cookies()
        const token = cookieStore.get('notes_token')?.value

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
        }

        if (token) {
            headers['Authorization'] = `Bearer ${token}`
        }

        const res = await fetch(`${API_URL}/notes/${id}`, {
            method: 'GET',
            headers,
            cache: 'no-store', // Ensure fresh data
        })

        if (!res.ok) {
            if (res.status === 404) {
                return null
            }
            throw new Error(`Failed to fetch note: ${res.status} ${res.statusText}`)
        }

        const data = await res.json()
        // The backend returns { code, message, data: Note } or just Note depending on implementation.
        // Based on api.ts, axios interceptor might be stripping the envelope, but fetch won't.
        // Let's assume the standard response format mentioned in instructions: { code, message, data, ... }
        // However, api.ts `getById` casts `res` to `Note`. 
        // Let's check `api.ts` again. It says `api.get<Note>(...)`. 
        // If the backend returns an envelope, `api.ts` interceptor usually handles it.
        // Let's look at `api.ts` interceptors again.

        // Looking at api.ts, I don't see an interceptor that unwraps `data.data`.
        // But `api.get<Note>` implies the response body IS the Note object, OR axios automatically returns `data` property of the response object which is the body.
        // Wait, axios response object has `data` property which is the body.
        // If the body is `{ code: 200, data: { ...note } }`, then `res.data` is that object.
        // If `api.ts` returns `res` (which is the body in axios interceptor usually? No, axios returns a response object).
        // `api.interceptors.response.use((response) => { return response.data }, ...)` is a common pattern.
        // Let's check `api.ts` response interceptor.

        return data.data || data // Fallback if it's direct
    } catch (error) {
        console.error('Error fetching note:', error)
        return null
    }
}
