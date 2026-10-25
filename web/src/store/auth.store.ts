import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type AuthUser } from '@/api/auth.api';
import { CLERK_PUBLISHABLE_KEY } from '@/lib/constants';

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True once mount-time token validation has finished. */
  ready: boolean;
  isLoading: boolean;
  /** Sync Clerk user data into local store (called from ClerkUserSync). */      syncClerkUser: (clerkUser: { id: string; email?: string; username?: string; imageUrl?: string; createdAt?: string } | null) => void;
  logout: () => Promise<void>;
  initialize: () => Promise<void>;
  setToken: (token: string) => void;
}

const clerkEnabled = !!CLERK_PUBLISHABLE_KEY;

/** Single local account used when Clerk is not configured. */
const LOCAL_USER: AuthUser = {
  id: 'local',
  email: 'local@localhost',
  username: 'Local',
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      ready: false,
      isLoading: false,

      syncClerkUser: (clerkUser) => {
        if (!clerkUser) {
          set({ user: null, isAuthenticated: false, ready: true });
          return;
        }
        set({
          user: {
            id: clerkUser.id,
            email: clerkUser.email ?? '',
            username: clerkUser.username ?? clerkUser.email ?? 'User',
            image_url: clerkUser.imageUrl,
            created_at: clerkUser.createdAt,
          },
          isAuthenticated: true,
          ready: true,
        });
      },

      logout: async () => {
        if (!clerkEnabled) {
          set({ token: null, user: LOCAL_USER, isAuthenticated: true, ready: true });
          return;
        }
        // Clerk handles its own sign-out via useAuth().signOut()
        // This is called after Clerk sign-out to clear local state.
        set({ token: null, user: null, isAuthenticated: false, ready: true });
      },

      initialize: async () => {
        if (clerkEnabled) {
          // Clerk manages auth state — the store starts unauthenticated
          // and gets populated by the ClerkUserSync component.
          set({ ready: true });
          return;
        }

        // No login. The app always runs as the local user.
        set({
          token: null,
          user: LOCAL_USER,
          isAuthenticated: true,
          ready: true,
        });
      },

      setToken: (token: string) => {
        set({ token });
      },
    }),
    {
      name: 'rheoson-auth',
      partialize: (state) => ({ token: state.token }),
    }
  )
);
