# Harmonics

**CAUTION: Sometimes flashes.**

This project stacks a bunch of randomly selected trigonometric functions in a shader. You can [try it out online here](https://rileyjshaw.com/harmonics).

This is a quick project I made to test my [ShaderPad](https://github.com/rileyjshaw/shaderpad) library. It's not precious, so please [add pull requests](https://github.com/rileyjshaw/harmonics/pulls) if you have ideas! I’ll merge changes quickly as long as the app remains reasonably performant and the visual output looks good.

![Example program output](/screenshots/export.png)

## Keyboard controls

| Key | Action                          |
| --- | ------------------------------- |
| `C` | Cycle to next color mode        |
| `F` | Toggle fullscreen               |
| `G` | Cycle to next glitch mode\*     |
| `R` | Reload the page                 |
| `S` | Save the current frame as a PNG |

\*Glitch mode parameters are controlled with your mouse.

## Running locally

To run this project locally, you'll need to have Git and Node.js installed. Then, run the following commands:

```sh
git clone git@github.com:rileyjshaw/harmonics.git
cd harmonics
npm install
npm run dev
```

## License

[GNU General Public License v3.0](/LICENSE)
