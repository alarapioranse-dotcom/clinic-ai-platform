'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/Button';

interface PatientRow {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  createdAt: string;
}

type ListState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; patients: PatientRow[] };

/**
 * docs/product/06-acceptance-criteria.md's /dashboard/patients: an empty
 * clinic sees "No patients yet", and a backend failure shows "Couldn't load
 * patients" with a retry action — both require a client-side fetch so the
 * retry can re-run without a full page reload.
 */
export function PatientsList() {
  const [state, setState] = useState<ListState>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/patients');
      if (!response.ok) {
        throw new Error(`GET /api/patients returned ${response.status}`);
      }
      const body: { data: PatientRow[] } = await response.json();
      setState({ status: 'ready', patients: body.data });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    // Fetching from the API on mount is the "external data synchronization"
    // case the rule's own description carves out — there's no local state
    // this could be derived from instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function handleRetry() {
    setState({ status: 'loading' });
    load();
  }

  if (state.status === 'loading') {
    return (
      <p role="status" className="text-muted mt-8 text-sm">
        جارٍ التحميل...
      </p>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="mt-8">
        <p role="alert" className="text-sm font-medium text-red-700">
          تعذر تحميل بيانات المرضى
        </p>
        <Button variant="secondary" onClick={handleRetry} className="mt-3">
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  if (state.patients.length === 0) {
    return <p className="text-muted mt-8 text-sm">لا يوجد مرضى بعد</p>;
  }

  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full min-w-[28rem] border-collapse text-sm">
        <thead>
          <tr className="border-line border-b">
            <th className="text-start px-3 py-2 font-medium">الاسم</th>
            <th className="text-start px-3 py-2 font-medium">رقم الهاتف</th>
            <th className="text-start px-3 py-2 font-medium">تاريخ الإضافة</th>
          </tr>
        </thead>
        <tbody>
          {state.patients.map((patient) => (
            <tr key={patient.id} className="border-line border-b">
              <td className="px-3 py-2">{patient.displayName ?? '—'}</td>
              <td className="px-3 py-2" dir="ltr">
                {patient.phoneNumber ?? '—'}
              </td>
              <td className="px-3 py-2">{new Date(patient.createdAt).toLocaleDateString('ar')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
