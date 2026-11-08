import { Routes } from '@angular/router';
import { BoardPage } from './pages/board-page';
import { ModPage } from './pages/mod-page';
import { NotFoundPage } from './pages/not-found-page';
import { ProfilePage } from './pages/profile-page';
import { SignInPage } from './pages/sign-in-page';
import { ThemesPage } from './pages/themes-page';

export const routes: Routes = [
  { path: '', component: BoardPage, title: 'TheDailyStalk' },
  { path: 'day/:date', component: BoardPage, title: 'TheDailyStalk' },
  { path: 'themes', component: ThemesPage, title: 'Themes · TheDailyStalk' },
  { path: 'u/:handle', component: ProfilePage, title: 'TheDailyStalk' },
  { path: 'sign-in', component: SignInPage, title: 'Sign in · TheDailyStalk' },
  { path: 'mod', component: ModPage, title: 'Mod queue · TheDailyStalk' },
  { path: '**', component: NotFoundPage, title: 'Not found · TheDailyStalk' },
];
