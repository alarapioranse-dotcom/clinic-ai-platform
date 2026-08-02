import { Container } from '@/components/ui/Container';
import { siteConfig } from '@/config/site';

export function Footer() {
  return (
    <footer className="border-line border-t py-8">
      <Container className="text-muted flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
        <p>
          © {new Date().getFullYear()} {siteConfig.name}. جميع الحقوق محفوظة.
        </p>
        <p className="font-mono text-xs">Phase 0</p>
      </Container>
    </footer>
  );
}
