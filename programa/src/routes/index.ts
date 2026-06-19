import { Router } from 'express';
import { attachmentRoutes } from './AttachmentRoutes';
import { auditRoutes } from './AuditRoutes';
import { authRoutes } from './AuthRoutes';
import { catalogItemRoutes } from './CatalogItemRoutes';
import { companyProfileRoutes } from './CompanyProfileRoutes';
import { emailTemplateRoutes } from './EmailTemplateRoutes';
import { portalIntegrationsRoutes } from './PortalIntegrationsRoutes';
import { quoteRequestRoutes } from './QuoteRequestRoutes';
import { quoteRequestItemRoutes } from './QuoteRequestItemRoutes';
import { quoteResponseRoutes } from './QuoteResponseRoutes';
import { reportRoutes } from './ReportRoutes';
import { supplierContactRoutes } from './SupplierContactRoutes';
import { supplierRoutes } from './SupplierRoutes';
import { userRoutes } from './UserRoutes';

const router = Router();

router.use(portalIntegrationsRoutes);
router.use('/api/v1', authRoutes);
router.use('/api/v1', auditRoutes);
router.use('/api/v1', reportRoutes);
router.use('/api/v1', quoteRequestRoutes);
router.use('/api/v1', quoteResponseRoutes);
router.use('/api/v1', quoteRequestItemRoutes);
router.use('/api/v1', catalogItemRoutes);
router.use('/api/v1', supplierRoutes);
router.use('/api/v1', supplierContactRoutes);
router.use('/api/v1', attachmentRoutes);
router.use('/api/v1', userRoutes);
router.use('/api/v1/company-profile', companyProfileRoutes);
router.use('/api/v1/email-templates', emailTemplateRoutes);

export { router };
