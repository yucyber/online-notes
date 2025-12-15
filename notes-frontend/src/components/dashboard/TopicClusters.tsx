'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Loader2, Lightbulb, Tag as TagIcon, Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { fetchTopics, convertTopicToTag } from '@/lib/api'

type Topic = {
    name: string;
    count: number;
    noteIds: string[];
    preview: string[];
}

export function TopicClusters() {
    const [topics, setTopics] = useState<Topic[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [saving, setSaving] = useState<string | null>(null)
    const [savedTopics, setSavedTopics] = useState<Set<string>>(new Set())
    const router = useRouter()

    useEffect(() => {
        const loadTopics = async () => {
            try {
                const data = await fetchTopics()
                setTopics(data)
            } catch (err) {
                console.error(err)
                setError('Failed to load topics')
            } finally {
                setLoading(false)
            }
        }

        loadTopics()
    }, [])

    const handleTopicClick = (topic: Topic) => {
        // Navigate to notes page with filter
        const ids = topic.noteIds.join(',')
        router.push(`/dashboard/notes?ids=${ids}`)
    }

    const handleSaveAsTag = async (e: React.MouseEvent, topic: Topic) => {
        e.stopPropagation()
        if (saving || savedTopics.has(topic.name)) return

        setSaving(topic.name)
        try {
            await convertTopicToTag(topic.name, topic.noteIds)
            setSavedTopics(prev => new Set(prev).add(topic.name))
        } catch (err) {
            console.error(err)
            alert('Failed to save tag')
        } finally {
            setSaving(null)
        }
    }

    if (loading) {
        return (
            <Card className="mb-6">
                <CardHeader className="pb-2">
                    <CardTitle className="text-lg font-medium flex items-center gap-2">
                        <Lightbulb className="h-5 w-5 text-yellow-500" />
                        Knowledge Topics
                    </CardTitle>
                </CardHeader>
                <CardContent className="h-[100px] flex items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </CardContent>
            </Card>
        )
    }

    if (error || topics.length === 0) {
        return null
    }

    return (
        <Card className="mb-6">
            <CardHeader className="pb-2">
                <CardTitle className="text-lg font-medium flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-yellow-500" />
                    Knowledge Topics
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex flex-wrap gap-3">
                    {topics.map((topic, i) => (
                        <div
                            key={i}
                            className="group relative flex flex-col items-start gap-1 rounded-lg border p-3 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer w-full sm:w-[calc(50%-0.5rem)] md:w-[calc(33.33%-0.5rem)]"
                            onClick={() => handleTopicClick(topic)}
                        >
                            <div className="flex items-center justify-between w-full">
                                <span className="font-semibold text-sm">{topic.name}</span>
                                <div className="flex items-center gap-2">
                                    <Badge variant="secondary" className="text-xs">{topic.count}</Badge>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={(e) => handleSaveAsTag(e, topic)}
                                        disabled={saving === topic.name || savedTopics.has(topic.name)}
                                        title="Save as Tag"
                                    >
                                        {saving === topic.name ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : savedTopics.has(topic.name) ? (
                                            <Check className="h-3 w-3 text-green-500" />
                                        ) : (
                                            <TagIcon className="h-3 w-3" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-1 w-full">
                                {topic.preview.join(', ')}
                            </p>
                        </div>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}
