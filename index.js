const bodyParser = require('body-parser');
const express = require('express');
const logger = require('morgan');
const PF = require('pathfinding');
const app = express();
const {
  fallbackHandler,
  notFoundHandler,
  genericErrorHandler,
  poweredByHandler
} = require('./handlers.js');

// For deployment to Heroku, the port needs to be set using ENV, so
// we check for the port number in process.env
app.set('port', (process.env.PORT || 9001))

app.enable('verbose errors')

app.use(logger('dev'))
app.use(bodyParser.json())
app.use(poweredByHandler)

// --- SNAKE LOGIC GOES BELOW THIS LINE ---

// Handle POST request to '/start'
app.post('/start', (request, response) => {
  // NOTE: Do something here to start the game

  // Response data
  const data = {
    headType: 'silly',
    tailType: 'hook'
  }

  return response.json(data)
})

// Handle POST request to '/move'
app.post('/move', (request, response) => {
  // NOTE: Do something here to generate your move

  console.log(`turn: ${request.body.turn}`);
  const mySnakeHead = request.body.you.body[0];
  const mySnakeBody = request.body.you.body;
  const currentBoard = request.body.board;
  let otherSnakes = [];
  for (const snake of request.body.board.snakes) {
    if (request.body.you.id !== snake.id) {
      otherSnakes.push(snake);
    }
  }


  let possibleMoves = [{
    x: mySnakeHead.x,
    y: mySnakeHead.y - 1,
    name: 'up'
  }, {
    x: mySnakeHead.x,
    y: mySnakeHead.y + 1,
    name: 'down'
  }, {
    x: mySnakeHead.x - 1,
    y: mySnakeHead.y,
    name: 'left'
  }, {
    x: mySnakeHead.x + 1,
    y: mySnakeHead.y,
    name: 'right'
  }];
  try {
    possibleMoves = possibleMovesWhereGridExists(possibleMoves, currentBoard);
    possibleMoves = possibleMovesWhereBodyDoesntExist(possibleMoves, mySnakeBody);
    possibleMoves = possibleMovesWhereOtherSnakesDontExist(possibleMoves, otherSnakes);
    possibleMoves = possibleMovesWithoutHeadOnHeadCollisions(possibleMoves, otherSnakes);


    let nextMove = 'right';
    if (possibleMoves.length > 0) {
      const grid = setupPathfindGrid(currentBoard, mySnakeBody, otherSnakes);
      // const gridBackup = grid.clone();
      const finder = new PF.BestFirstFinder({
        allowDiagonal: false
      });
      const closestFoodList = findClosestFoodsWithoutNearbySnakes(mySnakeHead, currentBoard.food, otherSnakes);

      let nextStep = undefined;
      for (const closestFood of closestFoodList) {
        const path = finder.findPath(mySnakeHead.x, mySnakeHead.y, closestFood.x, closestFood.y, grid);
        if (path.length < 2) {
          continue;
        }

        nextStep = path[1];
        break;
      }

      let foundOptimalNextStepInPossibleMoves = false;
      for (const possibleMove of possibleMoves) {
        if (nextStep && nextStep.length >= 1) {
          if (possibleMove.x == nextStep[0] && possibleMove.y == nextStep[1]) {
            foundOptimalNextStepInPossibleMoves = true;
            nextMove = possibleMove.name;
            break;
          }
        }
      }

      if (!foundOptimalNextStepInPossibleMoves) {
        console.log(nextStep, 'not found in', possibleMoves);
        nextMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)].name;
      }
    }
    return response.json({
      move: nextMove
    })
  }
  catch (err) {
    console.error(err.message);
  }
})

function possibleMovesWhereGridExists(possibleMoves, board) {
  let newPossibleMoves = [];
  for (const move of possibleMoves) {
    if (move.x < 0 ||
      move.x >= board.width ||
      move.y < 0 ||
      move.y >= board.height) {
      continue;
    }
    newPossibleMoves.push(move)
  }
  return newPossibleMoves;
}

function possibleMovesWhereBodyDoesntExist(possibleMoves, snakeBody) {
  let newPossibleMoves = [];
  for (const move of possibleMoves) {
    let bodyPartIsInTheWay = false;
    for (const bodyPart of snakeBody) {
      if (move.x == bodyPart.x && move.y == bodyPart.y) {
        bodyPartIsInTheWay = true;
        break;
      }
    }
    if (!bodyPartIsInTheWay) {
      newPossibleMoves.push(move);
    }
  }
  return newPossibleMoves;
}
function possibleMovesWhereOtherSnakesDontExist(possibleMoves, snakes) {
  let newPossibleMoves = possibleMoves;
  for (const otherSnake of snakes) {
    newPossibleMoves = possibleMovesWhereBodyDoesntExist(newPossibleMoves, otherSnake.body);
  }
  return newPossibleMoves;
}

function possibleMovesWithoutHeadOnHeadCollisions(possibleMoves, otherSnakes) {
  return possibleMoves;
}

function setupPathfindGrid(board, mySnakeBody, otherSnakes) {
  let grid = new PF.Grid(board.width, board.height);
  for (const bodyPart of mySnakeBody) {
    grid.setWalkableAt(bodyPart.x, bodyPart.y, false);
  }
  for (const otherSnake of otherSnakes) {
    for (const bodyPart of otherSnake.body) {
      grid.setWalkableAt(bodyPart.x, bodyPart.y, false);
    }
  }
  return grid;
}

function findClosestFoodsWithoutNearbySnakes(currentSnakePosition, foods, otherSnakes) {
  let foodsUnSorted = [];
  for (const food of foods) {
    const foodDist = Math.abs(currentSnakePosition.x - food.x) + Math.abs(currentSnakePosition.y - food.y);

    let otherSnakeNearbyFood = false;
    for (const otherSnake of otherSnakes) {
      for (const bodyPart of otherSnake.body) {
        const otherSnakeXIsNearbyFood = bodyPart.x == food.x - 1 || bodyPart.x == food.x || bodyPart.x == food.x + 1;
        const otherSnakeYIsNearbyFood = bodyPart.y == food.y - 1 || bodyPart.y == food.y || bodyPart.y == food.y + 1;
        if (otherSnakeXIsNearbyFood && otherSnakeYIsNearbyFood) {
          console.log('Other Snake too close to food');
          otherSnakeNearbyFood = true;
        }
      }
    }

    if (!otherSnakeNearbyFood) {
      foodsUnSorted.push({
        x: food.x,
        y: food.y,
        distance: foodDist
      });
    }
  }
  foodsUnSorted.sort(function (a, b) { return a.distance - b.distance });
  return foodsUnSorted;
}

app.post('/end', (request, response) => {
  // NOTE: Any cleanup when a game is complete.
  return response.json({})
})

app.post('/ping', (request, response) => {
  // Used for checking if this snake is still alive.
  return response.json({});
})

// --- SNAKE LOGIC GOES ABOVE THIS LINE ---

app.use('*', fallbackHandler)
app.use(notFoundHandler)
app.use(genericErrorHandler)

app.listen(app.get('port'), () => {
  console.log('Server listening on port %s', app.get('port'))
})
