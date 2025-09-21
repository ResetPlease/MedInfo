import torch
from torchvision import models, transforms
from sklearn.preprocessing import MultiLabelBinarizer
from PIL import Image
from facenet_pytorch import MTCNN

# === Настройки ===
MODEL_PATH = "app/best_wrinkle_model.pth"
THRESHOLD = 0.5
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")

# === Загрузка модели и классов ===
checkpoint = torch.load(MODEL_PATH, map_location=device)
mlb_classes = checkpoint['mlb_classes']
NUM_CLASSES = len(mlb_classes)

class MultiLabelResNet(torch.nn.Module):
    def __init__(self, num_classes):
        super().__init__()
        self.backbone = models.resnet18(weights=None)
        in_features = self.backbone.fc.in_features
        self.backbone.fc = torch.nn.Linear(in_features, num_classes)

    def forward(self, x):
        return self.backbone(x)

# создаём модель через обёртку
model = MultiLabelResNet(NUM_CLASSES)
model.load_state_dict(checkpoint['model_state_dict'])
model.to(device)
model.eval()

# MultiLabelBinarizer
mlb = MultiLabelBinarizer(classes=mlb_classes)
mlb.fit([mlb_classes])

# MTCNN для кропа лиц
mtcnn = MTCNN(image_size=224, margin=20, post_process=True, device=device)

# Трансформация изображения
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(mean=[0.485, 0.456, 0.406],
                         std=[0.229, 0.224, 0.225])
])

def predict_wrinkles(image_path: str):
    """
    Принимает путь к обычному изображению (JPG/PNG), возвращает список предсказанных морщин.
    Если лицо не найдено, возвращает пустой список.
    """
    try:
        img = Image.open(image_path).convert("RGB")

        # --- Находим лицо ---
        face = mtcnn(img)
        if face is None:
            return []

        # --- Подготовка тензора ---
        face = face.unsqueeze(0).to(device)
        face = transform(face.squeeze(0)).unsqueeze(0)  # дополнительный transform для согласования с обучением

        # --- Инференс ---
        with torch.no_grad():
            outputs = model(face)
            preds = torch.sigmoid(outputs) > THRESHOLD
            labels = mlb.inverse_transform(preds.cpu().numpy())[0]

        return list(labels)

    except Exception as e:
        print(f"[ERROR] predict_wrinkles: {e}")
        return []

# === Пример использования ===
if __name__ == "__main__":
    image_path = "images/your_photo.jpg"
    labels = predict_wrinkles(image_path)
    print("Predicted wrinkles:", labels)

