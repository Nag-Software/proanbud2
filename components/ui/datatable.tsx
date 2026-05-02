'use client';

import React, { useState } from 'react';
import { Search, Filter, MoreHorizontal } from 'lucide-react';
import { ColumnDef } from '@/lib/types';

interface DataTableProps<T> {
  columns: ColumnDef[];
  data: T[];
  searchPlaceholder?: string;
  enableFiltering?: boolean;
  onRowClick?: (item: T) => void;
  compactOnMobile?: boolean;
  maxHeight?: string;
}

type SearchSectionProps = {
  searchPlaceholder: string;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  enableFiltering: boolean;
  onFilterClick?: () => void;
}

export function DataTableSearchSection({
  searchPlaceholder,
  searchTerm,
  onSearchChange,
  enableFiltering,
  onFilterClick,
}: SearchSectionProps) {
  return (
    <div className="flex-shrink-0 border-gray-200 min-w-sm">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <input
            type="text"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm"
          />
        </div>
        {enableFiltering && (
          <button
            className="flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 text-sm whitespace-nowrap"
            onClick={onFilterClick}
            type="button"
          >
            <Filter className="h-4 w-4" />
            <span className="hidden sm:inline">Filter</span>
          </button>
        )}
      </div>
    </div>
  );
}

type TableSectionProps<T> = {
  columns: ColumnDef[];
  data: T[];
  onRowClick?: (item: T) => void;
  compactOnMobile: boolean;
  maxHeight: string;
  sortConfig: { key: string; direction: 'asc' | 'desc' } | null;
  onSort: (key: string) => void;
}

export function DataTableSection<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  compactOnMobile,
  maxHeight,
  sortConfig,
  onSort,
}: TableSectionProps<T>) {
  const getWeightClass = (weight?: ColumnDef['weight']) => {
    switch (weight) {
      case 'thin':
        return 'font-thin'
      case 'medium':
        return 'font-medium'
      case 'semibold':
        return 'font-semibold'
      case 'bold':
        return 'font-bold'
      default:
        return 'font-normal'
    }
  }

  const getStatusClasses = (value: string) => {
    const normalized = value.toLowerCase()

    if (['draft', 'kladd'].includes(normalized)) {
      return 'border border-gray-200 bg-gray-50 text-gray-700'
    }

    if (['waiting', 'venter', 'pending'].includes(normalized)) {
      return 'border border-amber-200 bg-amber-50 text-amber-700'
    }

    if (['accepted', 'akseptert', 'approved', 'godkjent'].includes(normalized)) {
      return 'border border-emerald-200 bg-emerald-50 text-emerald-700'
    }

    if (['rejected', 'avvist'].includes(normalized)) {
      return 'border border-rose-200 bg-rose-50 text-rose-700'
    }

    if (['completed', 'fullført', 'done'].includes(normalized)) {
      return 'border border-sky-200 bg-sky-50 text-sky-700'
    }

    return 'border border-gray-200 bg-gray-50 text-gray-700'
  }

  return (
    <div
      className="flex-1 overflow-auto rounded-md border border-gray-200"
      style={{ maxHeight: maxHeight !== "none" ? maxHeight : undefined }}
    >
      <>
        <div className="hidden sm:block">
          <table className="w-full">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="border-b border-gray-200">
                {columns.map((column) => (
                  <th
                    key={column.accessorKey}
                    className="px-4 py-2 text-left text-xs font-medium text-gray-500 tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => onSort(column.accessorKey)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate">{column.header}</span>
                      {sortConfig?.key === column.accessorKey && (
                        <span className="text-primary flex-shrink-0">
                          {sortConfig?.direction === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {data.map((item, index) => (
                <tr
                  key={index}
                  className={`hover:bg-gray-50 transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onRowClick?.(item)}
                >
                  {columns.map((column) => (
                    <td key={column.accessorKey} className="text-sm py-1.5 px-4 text-gray-900">
                      {column.accessorKey === 'status' ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0 text-[12px] font-medium ${getStatusClasses(String(item[column.accessorKey] ?? ''))}`}
                        >
                          {column.cell
                            ? column.cell({ getValue: () => item[column.accessorKey], row: { original: item } })
                            : item[column.accessorKey]
                          }
                        </span>
                      ) : (
                        <div className={`max-w-xs truncate ${getWeightClass(column.weight)}`}>
                          {column.cell
                            ? column.cell({ getValue: () => item[column.accessorKey], row: { original: item } })
                            : item[column.accessorKey]
                          }
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="sm:hidden">
          <div className="divide-y divide-gray-200">
            {data.map((item, index) => (
              <div
                key={index}
                className={`p-4 ${onRowClick ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
                onClick={() => onRowClick?.(item)}
              >
                <div className="space-y-2">
                  {columns.slice(0, compactOnMobile ? 3 : columns.length).map((column) => (
                    <div key={column.accessorKey} className="flex justify-between items-start">
                      <span className="text-xs font-medium text-gray-500 tracking-wider flex-shrink-0 mr-2">
                        {column.header}
                      </span>
                      {column.accessorKey === 'status' ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0 text-[12px] font-medium ${getStatusClasses(String(item[column.accessorKey] ?? ''))}`}
                        >
                          {column.cell
                            ? column.cell({ getValue: () => item[column.accessorKey], row: { original: item } })
                            : item[column.accessorKey]
                          }
                        </span>
                      ) : (
                        <span className={`text-sm text-gray-900 text-right flex-1 truncate ${getWeightClass(column.weight)}`}>
                          {column.cell
                            ? column.cell({ getValue: () => item[column.accessorKey], row: { original: item } })
                            : item[column.accessorKey]
                          }
                        </span>
                      )}
                    </div>
                  ))}
                  {compactOnMobile && columns.length > 3 && (
                    <div className="pt-1 border-t border-gray-100">
                      <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700" type="button">
                        <MoreHorizontal className="h-3 w-3" />
                        Vis mer
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </>
    </div>
  );
}

export function useDataTable<T extends Record<string, any>>(data: T[]) {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    direction: 'asc' | 'desc';
  } | null>(null);

  const filteredData = React.useMemo(() => {
    return data.filter(item =>
      Object.values(item).some(value =>
        value?.toString().toLowerCase().includes(searchTerm.toLowerCase())
      )
    );
  }, [data, searchTerm]);

  const sortedData = React.useMemo(() => {
    if (!sortConfig) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];

      if (aValue < bValue) {
        return sortConfig.direction === 'asc' ? -1 : 1;
      }
      if (aValue > bValue) {
        return sortConfig.direction === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [filteredData, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(current => {
      if (current?.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc'
        };
      }
      return { key, direction: 'asc' };
    });
  };

  return {
    searchTerm,
    setSearchTerm,
    sortConfig,
    handleSort,
    data: sortedData,
  };
}

export function DataTable<T extends Record<string, any>>({ 
  columns, 
  data, 
  searchPlaceholder = "Søk...",
  enableFiltering = false,
  onRowClick,
  compactOnMobile = true,
  maxHeight = "none"
}: DataTableProps<T>) {
  const {
    searchTerm,
    setSearchTerm,
    sortConfig,
    handleSort,
    data: sortedData,
  } = useDataTable(data);

    return (
      <div className="rounded-md border border-gray-200 bg-white overflow-hidden">
          <DataTableSearchSection
            searchPlaceholder={searchPlaceholder}
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            enableFiltering={enableFiltering}
          />

          <DataTableSection
            columns={columns}
            data={sortedData}
            onRowClick={onRowClick}
            compactOnMobile={compactOnMobile}
            maxHeight={maxHeight}
            sortConfig={sortConfig}
            onSort={handleSort}
          />

        {/* Empty State */}
        {sortedData.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-12">
            <div className="text-center">
              <p className="text-gray-500 text-sm">Ingen data funnet</p>
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="mt-2 text-xs text-primary hover:text-primary/80"
                >
                  Fjern søkefilter
                </button>
              )}
            </div>
          </div>
        )}
    </div>
  );
}