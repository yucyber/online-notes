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

  // Debounce search for keyword
  useEffect(() => {
    const timer = setTimeout(() => {
      if (keyword !== (searchParams.get('keyword') || '')) {
        handleSearch();
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [keyword]);

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

  const handleSearch = () => {
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

    const nextQuery = params.toString();
    const currentQuery = typeof window !== 'undefined' ? window.location.search.replace(/^\?/, '') : '';
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
    <div className="bg-white p-4 rounded-lg shadow mb-6">
      <div className="flex gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <input
            type="text"
            placeholder="搜索笔记..."
            className="w-full pl-10 pr-4 py-2 border rounded-md"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
        </div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`px-4 py-2 border rounded-md flex items-center gap-2 ${isOpen ? 'bg-blue-50 border-blue-200 text-blue-600' : 'hover:bg-gray-50'}`}
        >
          <Filter className="h-4 w-4" />
          筛选
        </button>
        <button
          onClick={handleSearch}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
        >
          搜索
        </button>
      </div>

      {isOpen && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">分类</label>
            <select
              className="w-full border rounded-md p-2"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">所有分类</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
            <div className="mt-2">
              <div className="text-xs text-gray-500 mb-1">多分类</div>
              <div className="max-h-28 overflow-auto border rounded-md p-2">
                {categories.map(cat => {
                  const checked = selectedCategoryIds.includes(cat.id)
                  return (
                    <label key={cat.id} className="flex items-center gap-2 py-1 text-sm">
                      <input type="checkbox" checked={checked} onChange={(e) => {
                        const next = e.target.checked ? Array.from(new Set([...selectedCategoryIds, cat.id])) : selectedCategoryIds.filter(id => id !== cat.id)
                        setSelectedCategoryIds(next)
                      }} className="h-4 w-4 rounded border-gray-300" />
                      <span>{cat.name}</span>
                    </label>
                  )
                })}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <label className="text-xs text-gray-600">匹配模式</label>
                <select className="border rounded-md p-1 text-xs" value={categoriesMode} onChange={(e) => setCategoriesMode(e.target.value as 'any' | 'all')}>
                  <option value="any">包含任意一个</option>
                  <option value="all">同时包含全部</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
            <select
              className="w-full border rounded-md p-2"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">所有状态</option>
              <option value="published">已发布</option>
              <option value="draft">草稿</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">时间范围</label>
            <div className="flex gap-2 mb-2">
              <button onClick={setLastWeek} className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">最近一周</button>
              <button onClick={setLastMonth} className="text-xs px-2 py-1 bg-gray-100 rounded hover:bg-gray-200">最近一月</button>
            </div>
            <div className="flex gap-2">
              <input
                type="date"
                className="w-full border rounded-md p-2"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <span className="self-center">-</span>
              <input
                type="date"
                className="w-full border rounded-md p-2"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="md:col-span-3">
            <label className="block text-sm font-medium text-gray-700 mb-1">标签</label>
            <div className="mb-2 text-xs text-gray-500">
              {selectedTagIds.length <= 1
                ? '当前为单标签搜索：返回所有包含该标签的笔记'
                : '当前为多标签组合搜索：返回同时包含所有选定标签的笔记'}
            </div>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${selectedTagIds.includes(tag.id)
                    ? 'bg-blue-100 border-blue-300 text-blue-700'
                    : 'hover:bg-gray-50 border-gray-200 text-gray-700'
                    }`}
                  style={{ minHeight: 44 }}
                >
                  {tag.name}
                </button>
              ))}
              {tags.length === 0 && <span className="text-gray-400 text-sm">暂无标签</span>}
            </div>
          </div>

          <div className="md:col-span-3 flex justify-between items-center mt-2">
            <div className="flex gap-2">
              <button onClick={handleClear} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
                <X className="h-3 w-3" /> 清空条件
              </button>
              <button onClick={() => setIsSaveModalOpen(true)} className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1">
                <Save className="h-3 w-3" /> 保存筛选
              </button>
            </div>

            {savedFilters.length > 0 && (
              <div className="flex gap-2 items-center">
                <span className="text-sm text-gray-500">已保存:</span>
                <div className="flex gap-2 flex-wrap">
                  {savedFilters.map(filter => (
                    <button
                      key={filter.id}
                      onClick={() => applySavedFilter(filter)}
                      className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-1 rounded-full border"
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
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg w-96">
            <h3 className="text-lg font-medium mb-4">保存筛选条件</h3>
            <input
              type="text"
              placeholder="筛选器名称"
              className="w-full border rounded-md p-2 mb-4"
              value={newFilterName}
              onChange={(e) => setNewFilterName(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsSaveModalOpen(false)}
                className="px-4 py-2 border rounded-md hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleSaveFilter}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
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
