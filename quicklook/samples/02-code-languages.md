# Code highlighting

## TypeScript

```ts
type Note = { title: string; read: boolean };

export function markRead(note: Note): Note {
  return { ...note, read: true };
}
```

## Rust

```rust
fn greet(name: &str) -> String {
    format!("안녕하세요, {name}!")
}
```

## Python

```python
def fibonacci(limit: int) -> list[int]:
    values = [0, 1]
    while values[-1] < limit:
        values.append(values[-1] + values[-2])
    return values[:-1]
```

## Swift

```swift
struct PreviewNote {
    let title: String
    let content: String
}
```
