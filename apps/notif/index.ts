import type { AppModule } from '../_shared/app-types'
import { createNotifActions } from './main'

export const app: AppModule = {
  id: 'notif',
  name: 'Notif',
  pageTitle: 'Even Hub Notif App',
  connectLabel: 'Connect Notif',
  actionLabel: 'Test Notification',
  initialStatus: 'Notif app ready',
  createActions: createNotifActions,
}

export default app
