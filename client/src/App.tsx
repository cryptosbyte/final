import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";
import CalendarPage from "@/pages/calendar";
import StatsPage from "@/pages/stats";
import PhotosPage from "@/pages/photos";
import BookmarksPage from "@/pages/bookmarks";
import ResourcesPage from "@/pages/resources";
import NotebookPage from "@/pages/notebook";
import NotebookPublicPage from "@/pages/notebook-public";
import FlashcardsPage from "@/pages/flashcards";
import FlashcardDeckPage from "@/pages/flashcard-deck";
import FlashcardStudyPage from "@/pages/flashcard-study";
import { AuthProvider } from "@/lib/auth-context";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={CalendarPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/photos" component={PhotosPage} />
        <Route path="/photos/folder/:id" component={PhotosPage} />
        <Route path="/photos/recently-deleted" component={PhotosPage} />
        <Route path="/bookmarks" component={BookmarksPage} />
        <Route path="/resources" component={ResourcesPage} />
        <Route path="/resources/:id" component={NotebookPage} />
        <Route path="/r/:id" component={NotebookPublicPage} />
        <Route path="/flashcards" component={FlashcardsPage} />
        <Route path="/flashcards/:id" component={FlashcardDeckPage} />
        <Route path="/flashcards/:id/study" component={FlashcardStudyPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
