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

const scoreDeductionForOutOfBounds = 100;
const scoreDeductionForSnakeBodyInTheWay = 100;
const scoreDeductionForPossibleHeadOnHeadCollision = 50;
const scoreDifferenceNeededToOverridePathFinding = 25;


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

  console.log(`turn : ${request.body.turn} - snake: ${request.body.you.name}`);
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
    score: 100,
    name: 'up'
  }, {
    x: mySnakeHead.x,
    y: mySnakeHead.y + 1,
    score: 100,
    name: 'down'
  }, {
    x: mySnakeHead.x - 1,
    y: mySnakeHead.y,
    score: 100,
    name: 'left'
  }, {
    x: mySnakeHead.x + 1,
    y: mySnakeHead.y,
    score: 100,
    name: 'right'
  }];
  try {
    possibleMoves = possibleMovesWhereGridExists(possibleMoves, currentBoard);
    possibleMoves = possibleMovesWhereBodyDoesntExist(possibleMoves, mySnakeBody);
    possibleMoves = possibleMovesWhereOtherSnakesDontExist(possibleMoves, otherSnakes);
    possibleMoves = possibleMovesWithoutHeadOnHeadCollisions(possibleMoves, otherSnakes);

    let nextMove = { name: 'right' };
    let shouldJustDoRandomMove = true;
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
          console.log('Path to nearest food is not possible');
          continue;
        }

        nextStep = path[1];
        break;
      }

      for (const possibleMove of possibleMoves) {
        if (nextStep && nextStep.length >= 1) {
          if (possibleMove.x == nextStep[0] && possibleMove.y == nextStep[1]) {
            nextMove = possibleMove;
            shouldJustDoRandomMove = false;
            break;
          }
        }
      }

      let highestScoringMove = { score: 0 };
      for (const move of possibleMoves) {
        if (move.score > highestScoringMove.score) {
          highestScoringMove = move;
        }
      }

      if (highestScoringMove.score - nextMove.score >= scoreDifferenceNeededToOverridePathFinding) {
        console.log(`Pathfinding move is not the highest scoring move`);
        nextMove = highestScoringMove;
        shouldJustDoRandomMove = false;
      }

      if (shouldJustDoRandomMove) {
        console.log('doin\' a random');
        nextMove = GetRandomWeightedMove(possibleMoves);
      }
    }
    return response.json({
      move: nextMove.name
    })
  }
  catch (err) {
    console.error(err.message);
  }
})

function GetRandomWeightedMove(possibleMoves) {
  let totalWeight = 0;
  for (let move of possibleMoves) {
    totalWeight += move.score;
  }

  let randomWeight = Math.random() * totalWeight;
  for (let move of possibleMoves) {
    randomWeight = randomWeight - move.score;
    if (randomWeight <= 0) {
      return move;
    }
  }
  return possibleMoves[Math.floor(Math.random() * possibleMoves.length)]
}

function possibleMovesWhereGridExists(possibleMoves, board) {
  let newPossibleMoves = [];
  for (let move of possibleMoves) {
    if (move.x < 0 ||
      move.x >= board.width ||
      move.y < 0 ||
      move.y >= board.height) {
      move.score = move.score - scoreDeductionForOutOfBounds;
    }
    newPossibleMoves.push(move)
  }
  return newPossibleMoves;
}

function possibleMovesWhereBodyDoesntExist(possibleMoves, snakeBody) {
  let newPossibleMoves = [];
  for (let move of possibleMoves) {
    let bodyPartIsInTheWay = false;
    for (let bodyIndex = 0; bodyIndex < snakeBody.length - 1; bodyIndex++) { //Ignoring tails
      const bodyPart = snakeBody[bodyIndex];
      if (move.x == bodyPart.x && move.y == bodyPart.y) {
        bodyPartIsInTheWay = true;
        break;
      }
    }
    if (bodyPartIsInTheWay) {
      move.score = move.score - scoreDeductionForSnakeBodyInTheWay;
    }
    newPossibleMoves.push(move);
  }
  return newPossibleMoves;
}
function possibleMovesWhereOtherSnakesDontExist(possibleMoves, otherSnakes) {
  let newPossibleMoves = possibleMoves;
  for (const otherSnake of otherSnakes) {
    newPossibleMoves = possibleMovesWhereBodyDoesntExist(newPossibleMoves, otherSnake.body);
  }
  return newPossibleMoves;
}

function possibleMovesWithoutHeadOnHeadCollisions(possibleMoves, otherSnakes) {
  let newPossibleMoves = [];

  for (let move of possibleMoves) {
    let otherSnakeHeadNearby = false;
    for (const otherSnake of otherSnakes) {
      const otherSnakeHead = otherSnake.body[0];
      otherSnakeHeadNearby = IsOtherSnakeHeadNearMove(move, otherSnakeHead);
    }
    if (otherSnakeHeadNearby) {
      move.score = move.score - scoreDeductionForPossibleHeadOnHeadCollision;
    }
    newPossibleMoves.push(move);
  }
  return newPossibleMoves;
}

function setupPathfindGrid(board, mySnakeBody, otherSnakes) {
  let grid = new PF.Grid(board.width, board.height);
  for (let bodyIndex = 0; bodyIndex < mySnakeBody.length - 1; bodyIndex++) { //Ignoring tails
    const bodyPart = mySnakeBody[bodyIndex];
    grid.setWalkableAt(bodyPart.x, bodyPart.y, false);
  }
  for (const otherSnake of otherSnakes) {
    for (let bodyIndex = 0; bodyIndex < otherSnake.body.length - 1; bodyIndex++) { //Ignoring tails
      const bodyPart = otherSnake.body[bodyIndex];
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
      const otherSnakeHead = otherSnake.body[0];
      otherSnakeHeadNearby = IsOtherSnakeHeadNearMove(food, otherSnakeHead);
    }

    if (otherSnakeNearbyFood) {
      console.log('Other Snake too close to food');
    } else {
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


function IsOtherSnakeHeadNearMove(targetMove, otherSnakeHead) {
  const otherSnakeIsAboveMove = otherSnakeHead.x == targetMove.x && otherSnakeHead.y == targetMove.y - 1;
  const otherSnakeIsBelowMove = otherSnakeHead.x == targetMove.x && otherSnakeHead.y == targetMove.y + 1;
  const otherSnakeIsLeftOfMove = otherSnakeHead.x == targetMove.x - 1 && otherSnakeHead.y == targetMove.y;
  const otherSnakeIsRightOfMove = otherSnakeHead.x == targetMove.x + 1 && otherSnakeHead.y == targetMove.y;

  return (otherSnakeIsAboveMove || otherSnakeIsBelowMove || otherSnakeIsLeftOfMove || otherSnakeIsRightOfMove);
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
