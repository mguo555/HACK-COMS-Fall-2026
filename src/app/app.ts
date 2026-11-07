import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActionBar } from './components/action-bar/action-bar';
import { ChatPanel } from './components/chat-panel/chat-panel';
import { GameLog } from './components/game-log/game-log';
import { HandResult } from './components/hand-result/hand-result';
import { Lobby } from './components/lobby/lobby';
import { PokerTable } from './components/poker-table/poker-table';
import { StartScreen } from './components/start-screen/start-screen';
import { GameClient } from './game/game-client';

@Component({
  selector: 'app-root',
  imports: [ActionBar, ChatPanel, GameLog, HandResult, Lobby, PokerTable, StartScreen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly client = inject(GameClient);
}
