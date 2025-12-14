'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, Filter, X, Save } from 'lucide-react';
import { categoriesAPI, tagsAPI, savedFiltersAPI } from '@/lib/api';
import { Category, Tag, SavedFilter } from '@/types';

export default function SearchFilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [isOpen, setIsOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);

  // Form states
  const [keyword, setKeyword] = useState(searchParams.get('keyword') || '');
  const [categoryId, setCategoryId] = useState(searchParams.get('categoryId') || '');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [categoriesMode, setCategoriesMode] = useState<'any' | 'all'>((searchParams.get('categoriesMode') as 'any' | 'all') || 'any');
  const [tagsMode, setTagsMode] = useState<'any' | 'all'>((searchParams.get('tagsMode') as 'any' | 'all') || 'any');
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [status, setStatus] = useState(searchParams.get('status') || '');
  // NLQ 开关与模式
  const [nlqEnabled, setNlqEnabled] = useState((searchParams.get('nlq') || '') === '1')
  const [nlqMode, setNlqMode] = useState<'keyword' | 'vector' | 'hybrid'>((searchParams.get('mode') as any) || 'hybrid')

  // Save filter state
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  useEffect(() => {
    loadCategories();
    loadTags();
    loadSavedFilters();
  }, []);

  useEffect(() => {
    // Initialize selectedTagIds from searchParams
    // Handle both comma-separated string (legacy/simple) or multiple params
    const tagsParam = searchParams.getAll('tagIds');
    if (tagsParam.length > 0) {
      setSelectedTagIds(tagsParam.filter(id => id !== 'undefined' && id !== 'null' && id !== ''));
    } else {
      // fallback check for legacy/manual ?tagIds=a,b format if needed, or just single
      const singleTag = searchParams.get('tagIds');
      if (singleTag && singleTag !== 'undefined' && singleTag !== 'null') {
        setSelectedTagIds([singleTag]);
      } else {
        setSelectedTagIds([]);
      }
    }

    setKeyword(searchParams.get('keyword') || '');
    setCategoryId(searchParams.get('categoryId') || '');
    const catsParam = searchParams.getAll('categoryIds')
    setSelectedCategoryIds(catsParam.length > 0 ? catsParam : [])
    setStartDate(searchParams.get('startDate') || '');
    setEndDate(searchParams.get('endDate') || '');
    setStatus(searchParams.get('status') || '');
    setTagsMode((searchParams.get('tagsMode') as 'any' | 'all') || 'any');
    setCategoriesMode((searchParams.get('categoriesMode') as 'any' | 'all') || 'any');
  }, [searchParams]);

  // 根据选择的标签数量自动切换匹配模式：单标签=>any，多标签=>all
  useEffect(() => {
    const next = selectedTagIds.length > 1 ? 'all' : 'any'
    if (tagsMode !== next) setTagsMode(next)
  }, [selectedTagIds])


  const loadCategories = async () => {
    try {
      const data = await categoriesAPI.getAll();
      setCategories(data);
    } catch (error) {
      console.error('Failed to load categories', error);
    }
  };

  const loadTags = async () => {
    try {
      const data = await tagsAPI.getAll();
      setTags(data);
    } catch (error) {
      console.error('Failed to load tags', error);
    }
  };


  const loadSavedFilters = async () => {
    try {
      const data = await savedFiltersAPI.getAll();
      setSavedFilters(data);
    } catch (error) {
      console.error('Failed to load saved filters', error);
    }
  };

  const handleSearch = (source?: 'button' | 'debounce' | 'enter') => {
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (categoryId) params.set('categoryId', categoryId);
    Array.from(new Set(selectedCategoryIds.filter(Boolean))).forEach(id => params.append('categoryIds', id));
    if (selectedCategoryIds.length > 0 && categoriesMode) params.set('categoriesMode', categoriesMode);
    Array.from(new Set(selectedTagIds.filter(Boolean))).forEach(id => params.append('tagIds', id));
    if (selectedTagIds.length > 0 && tagsMode) params.set('tagsMode', tagsMode);
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (status) params.set('status', status);
    if (nlqEnabled) {
      params.set('nlq', '1')
      params.set('mode', nlqMode)
    }

    const nextQuery = params.toString();
    const currentQuery = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
    const searchId = `s_${Date.now()}_${Math.floor(Math.random() * 1e6)}`
    try {
      sessionStorage.setItem('lastSearchId', searchId)
    } catch { }
    document.dispatchEvent(new CustomEvent('search:trigger', {
      detail: {
        searchId,
        source: source || 'button',
        keyword,
        categoryId,
        tagIds: Array.from(new Set(selectedTagIds.filter(Boolean))),
        tagsMode,
        startDate,
        endDate,
        status,
        nlqEnabled,
        nlqMode,
        nextQuery,
        time: new Date().toISOString(),
      }
    }))
    document.dispatchEvent(new CustomEvent('rum', {
      detail: {
        type: 'ui:search_trigger',
        name: 'Search',
        value: 1,
        meta: { searchId, source: source || 'button' }
      }
    }))
    console.log('Trigger search with:', {
      keyword,
      categoryId,
      tagIds: Array.from(new Set(selectedTagIds.filter(Boolean))),
      tagsMode,
      startDate,
      endDate,
      status,
      nextQuery,
      time: new Date().toISOString(),
    })
    if (nextQuery === currentQuery) return;

    router.push(`/dashboard/notes?${nextQuery}`);
  };

  const handleClear = () => {
    setKeyword('');
    setCategoryId('');
    setSelectedCategoryIds([]);
    setCategoriesMode('any');
    setSelectedTagIds([]);
    setStartDate('');
    setEndDate('');
    setStatus('');
    setTagsMode('any');
    setNlqEnabled(false)
    setNlqMode('hybrid')
    router.push('/dashboard/notes');
  };

  const handleSaveFilter = async () => {
    if (!newFilterName) return;
    try {
      await savedFiltersAPI.create({
        name: newFilterName,
        criteria: {
          keyword,
          categoryId,
          tagIds: selectedTagIds,
          startDate,
          endDate,
          status: status as 'published' | 'draft' | undefined
        }
      });
      setNewFilterName('');
      setIsSaveModalOpen(false);
      loadSavedFilters();
    } catch (error) {
      console.error('Failed to save filter', error);
    }
  };

  const applySavedFilter = (filter: SavedFilter) => {
    setKeyword(filter.criteria.keyword || '');
    setCategoryId(filter.criteria.categoryId || '');
    setSelectedCategoryIds(filter.criteria.categoryIds || []);
    setSelectedTagIds(filter.criteria.tagIds || []);
    setStartDate(filter.criteria.startDate || '');
    setEndDate(filter.criteria.endDate || '');
    setStatus(filter.criteria.status || '');
    setTagsMode((filter.criteria.tagsMode as 'any' | 'all') || 'any');

    const params = new URLSearchParams();
    if (filter.criteria.keyword) params.set('keyword', filter.criteria.keyword || '');
    if (filter.criteria.categoryId) params.set('categoryId', filter.criteria.categoryId || '');
    if (filter.criteria.categoryIds && filter.criteria.categoryIds.length > 0) filter.criteria.categoryIds.forEach(id => params.append('categoryIds', id));
    if (filter.criteria.tagIds && filter.criteria.tagIds.length > 0) {
      filter.criteria.tagIds.forEach(id => params.append('tagIds', id));
    }
    if (filter.criteria.tagsMode) params.set('tagsMode', filter.criteria.tagsMode);
    if (filter.criteria.startDate) params.set('startDate', filter.criteria.startDate || '');
    if (filter.criteria.endDate) params.set('endDate', filter.criteria.endDate || '');
    if (filter.criteria.status) params.set('status', filter.criteria.status || '');

    router.push(`/dashboard/notes?${params.toString()}`);
  }

  const toggleTag = (tagId: string) => {
    if (selectedTagIds.includes(tagId)) {
      setSelectedTagIds(selectedTagIds.filter(id => id !== tagId));
    } else {
      setSelectedTagIds([...selectedTagIds, tagId]);
    }
  };

  const setLastWeek = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  const setLastMonth = () => {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };

  return (
    <div className="p-4 rounded-lg shadow mb-6 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}>
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="搜索笔记..."
            className="w-full pl-10 pr-4 py-2 border rounded-md placeholder-muted"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch('enter')}
            style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
          />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`px-4 py-2 border rounded-md flex items-center gap-2`}
          style={isOpen ? { background: 'var(--primary-600)', borderColor: 'var(--primary-600)', color: '#fff', minHeight: 44 } : { borderColor: 'var(--interactive-border)', color: 'var(--on-surface)', minHeight: 44 }}
        >
          <Filter className="h-4 w-4" />
          筛选
        </button>
        <button
          onClick={() => handleSearch('button')}
          className="px-4 py-2 rounded-md"
          style={{ background: 'var(--primary-600)', color: '#fff', minHeight: 44 }}
        >
          搜索
        </button>
        <label className="inline-flex items-center gap-2 text-sm ml-2" style={{ color: 'var(--text-muted)' }}>
          <input type="checkbox" checked={nlqEnabled} onChange={(e) => setNlqEnabled(e.target.checked)} />
          语义搜索
        </label>
        {nlqEnabled && (
          <select className="border rounded-md p-2 text-sm" value={nlqMode} onChange={(e) => setNlqMode(e.target.value as any)} style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
            <option value="hybrid">混合</option>
            <option value="keyword">关键词</option>
            <option value="vector">向量</option>
          </select>
        )}
      </div>

      {isOpen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--on-surface)' }}>分类</label>
            <select
              className="w-full border rounded-md p-2"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
            >
              <option value="">所有分类</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <div className="mt-2">
              <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>多分类</div>
              <div className="max-h-28 overflow-auto border rounded-md p-2" style={{ borderColor: 'var(--border)', background: 'var(--surface-1)' }}>
                {categories.map(cat => {
                  const checked = selectedCategoryIds.includes(cat.id)
                  return (
                    <label key={cat.id} className="flex items-center gap-2 py-1 text-sm" style={{ color: 'var(--on-surface)' }}>
                      <input type="checkbox" checked={checked} onChange={(e) => {
                        const next = e.target.checked ? Array.from(new Set([...selectedCategoryIds, cat.id])) : selectedCategoryIds.filter(id => id !== cat.id)
                        setSelectedCategoryIds(next)
                      }} className="h-4 w-4 rounded" style={{ borderColor: 'var(--border)' }} />
                      <span>{cat.name}</span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs" style={{ color: 'var(--text-muted)' }}>匹配模式</label>
                <select className="border rounded-md p-1 text-xs" value={categoriesMode} onChange={(e) => setCategoriesMode(e.target.value as 'any' | 'all')} style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}>
                  <option value="any">包含任意一个</option>
                  <option value="all">同时包含全部</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--on-surface)' }}>状态</label>
            <select
              className="w-full border rounded-md p-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
            >
              <option value="">所有状态</option>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--on-surface)' }}>时间范围</label>
            <div className="flex gap-2 mb-2">
              <button onClick={setLastWeek} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-2)', color: 'var(--on-surface)' }}>最近一周</button>
              <button onClick={setLastMonth} className="text-xs px-2 py-1 rounded" style={{ background: 'var(--surface-2)', color: 'var(--on-surface)' }}>最近一月</button>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                className="w-full border rounded-md p-2"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
              />
              <span className="self-center">-</span>
              <input
                type="date"
                className="w-full border rounded-md p-2"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--on-surface)' }}>标签</label>
            <div className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {selectedTagIds.length <= 1
                ? '当前为单标签搜索：返回所有包含该标签的笔记'
                : '当前为多标签组合搜索：返回同时包含所有选定标签的笔记'}
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors`}
                  style={{
                    ...(selectedTagIds.includes(tag.id)
                      ? { background: 'var(--primary-50)', borderColor: 'var(--primary-100)', color: 'var(--primary-600)' }
                      : { borderColor: 'var(--border)', color: 'var(--on-surface)', background: 'var(--surface-1)' }),
                    minHeight: 44
                  }}
                >
                  {tag.name}
                </button>
              ))}
              {tags.length === 0 && <span className="text-sm" style={{ color: 'var(--text-muted)' }}>暂无标签</span>}
            </div>
          </div>

          <div className="md:col-span-3 flex justify-between items-center mt-2">
            <div className="flex gap-2">
              <button onClick={handleClear} className="text-sm flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                <X className="h-3 w-3" /> 清空条件
              </button>
              <button onClick={() => setIsSaveModalOpen(true)} className="text-sm flex items-center gap-1" style={{ color: 'var(--primary-600)' }}>
                <Save className="h-3 w-3" /> 保存筛选
              </button>
            </div>

            {savedFilters.length > 0 && (
              <div className="flex gap-2 items-center">
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>已保存:</span>
                <div className="flex gap-2 flex-wrap">
                  {savedFilters.map((filter, index) => (
                    <button
                      key={filter.id || index}
                      onClick={() => applySavedFilter(filter)}
                      className="text-xs px-2 py-1 rounded-full border"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}
                    >
                      {filter.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isSaveModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'var(--overlay)' }}>
          <div className="p-6 rounded-lg w-96 border" style={{ background: 'var(--surface-1)', borderColor: 'var(--border)', color: 'var(--on-surface)' }}>
            <h3 className="text-lg font-medium mb-4">保存筛选条件</h3>
            <input
              type="text"
              placeholder="筛选器名称"
              className="w-full border rounded-md p-2 mb-4"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
              style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 border rounded-md"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-1)', color: 'var(--on-surface)' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveFilter}
                className="px-4 py-2 rounded-md"
                style={{ background: 'var(--primary-600)', color: '#fff' }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
