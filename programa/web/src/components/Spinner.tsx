export default function Spinner({ size }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'spinner spinner--sm' : 'spinner';
  return <div className={cls} role="status" aria-label="Carregando" />;
}
