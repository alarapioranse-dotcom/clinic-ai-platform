import { PatientsList } from './PatientsList';

export default function PatientsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="font-display text-2xl font-bold">المرضى</h1>
      <p className="text-muted mt-2 text-sm">قائمة مرضى عيادتك.</p>
      <PatientsList />
    </div>
  );
}
