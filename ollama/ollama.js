import { Ollama } from "ollama";

export const ollama = new Ollama({
    host: "https://ollama.com",
    headers: {
        Authorization: "Bearer e960dda5e76b4533ac77e65fa0df80c7.w9GFQqDk1pAkryWtJOvN5415"
    }
});
