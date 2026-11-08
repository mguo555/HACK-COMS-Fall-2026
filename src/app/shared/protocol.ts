// JSON shapes shared by the server (server/) and the browser.

/** live: on the board. hidden: reported, waiting for a mod. deleted: by its owner. removed: by a mod. */
export type PostStatus = 'live' | 'hidden' | 'deleted' | 'removed';

export interface Me {
  handle: string | null;
  email: string;
  isAdmin: boolean;
}

export interface DayInfo {
  /** YYYY-MM-DD in the site's time zone (America/New_York by default). */
  date: string;
  theme: string;
}

export interface SessionInfo {
  user: Me | null;
  today: DayInfo;
  /** When the next day and theme start, in ms since the epoch. */
  nextDayAt: number;
  /** When true, only signed-in students can see photos. */
  membersOnly: boolean;
}

export interface Post {
  id: string;
  day: string;
  handle: string;
  width: number;
  height: number;
  likes: number;
  liked: boolean;
  mine: boolean;
  createdAt: number;
}

export interface MyPost extends Post {
  status: PostStatus;
}

export interface Board {
  day: DayInfo;
  isToday: boolean;
  posts: Post[];
  /** Your own post for this day, whatever its status. Null if you didn't post or aren't signed in. */
  mine: MyPost | null;
}

export interface DaySummary extends DayInfo {
  posts: number;
  /** The most liked photo of the day, used as a cover. */
  cover: string | null;
}

export interface ThemeList {
  today: DayInfo;
  upcoming: DayInfo[];
  past: DaySummary[];
}

export interface ProfilePost extends MyPost {
  theme: string;
}

export interface Profile {
  handle: string;
  joinedAt: number;
  streak: number;
  days: number;
  likes: number;
  isMe: boolean;
  posts: ProfilePost[];
}

export interface ModItem {
  post: MyPost;
  theme: string;
  email: string;
  reports: number;
  banned: boolean;
}

export interface ModQueue {
  items: ModItem[];
}

export interface LikeResult {
  likes: number;
  liked: boolean;
}

export interface ApiErrorBody {
  error: string;
}
