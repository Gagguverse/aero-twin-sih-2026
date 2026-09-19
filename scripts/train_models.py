"""
==========================================================================
AERO TWIN — Offline Machine Learning Training Pipeline
SIH Problem Statement: SIH26054 | DRDO MALE UAV Aero Piston Engine
Theme: Robotics & Drones | Category: Software

Trains real scikit-learn models on physics-grounded synthetic telemetry:
1. IsolationForest: Unsupervised Anomaly Detection
2. RandomForestClassifier: Multiclass Fault Classification

Exports:
- models/isolation_forest.pkl & models/fault_classifier.pkl (Python Joblib)
- models/isolation_forest.json & models/fault_classifier.json (Browser Tree Engine)
- models/model_metadata.json (Metrics, Feature Names, Class Labels)
==========================================================================
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

# Set deterministic random seed
SEED = 42
np.random.seed(SEED)

FEATURE_NAMES = [
    'rpm',           # Crankshaft speed (RPM)
    'cht_avg',       # Average Cylinder Head Temp (°C)
    'egt_avg',       # Average Exhaust Gas Temp (°C)
    'oil_press',     # Oil Pressure (PSI)
    'oil_temp',      # Oil Temperature (°C)
    'fuel_flow',     # Fuel Flow Rate (L/hr)
    'map',           # Manifold Absolute Pressure (inHg)
    'load',          # Calculated Engine Load (%)
    'vibration_rms'  # Engine Block Vibration (mm/s)
]

CLASS_NAMES = [
    'HEALTHY',
    'THERMAL_DEGRADATION',
    'LUBRICATION_DEGRADATION',
    'RPM_INSTABILITY'
]

def generate_synthetic_dataset(samples_per_class=1000):
    """
    Generates synthetic engine telemetry respecting directional thermodynamic physics:
    Throttle/Load -> Fuel Flow -> EGT -> CHT with lag -> Oil Temp -> Oil Pressure.
    """
    data = []
    labels = []

    print(f"Generating synthetic aero engine telemetry ({samples_per_class * 4} total samples)...")

    # -------------------------------------------------------------------------
    # Class 0: HEALTHY (Nominal Operating Envelope)
    # -------------------------------------------------------------------------
    for _ in range(samples_per_class):
        # Throttle between 0.35 (descent/loiter) and 0.85 (cruise/climb)
        throttle = np.random.uniform(0.35, 0.85)
        load = throttle * 100.0 + np.random.normal(0, 1.0)
        rpm = 1800 + (throttle * 3333) + np.random.normal(0, 15)
        map_press = 14.9 + (throttle * 25.0) + np.random.normal(0, 0.2)
        
        norm_load = load / 100.0
        norm_rpm = rpm / 5000.0
        fuel_flow = (38.0 * norm_load * norm_rpm) + np.random.normal(0, 0.3)
        
        egt_avg = 720 + (norm_load * 85) + np.random.normal(0, 3.0)
        cht_avg = 145 + (norm_load * 28) + np.random.normal(0, 1.0)
        oil_temp = 82 + (norm_load * 10) + np.random.normal(0, 0.8)
        
        temp_oil_drop = max(0.0, (oil_temp - 85) * 0.12)
        oil_press = 38.0 + (rpm / 5000.0) * 18.0 - temp_oil_drop + np.random.normal(0, 0.4)
        vibration_rms = 1.45 + (norm_load * 0.4) + np.random.normal(0, 0.05)

        data.append([rpm, cht_avg, egt_avg, oil_press, oil_temp, fuel_flow, map_press, load, vibration_rms])
        labels.append(0)

    # -------------------------------------------------------------------------
    # Class 1: THERMAL_DEGRADATION (Combustion Overheat / Fuel Mixture Anomaly)
    # -------------------------------------------------------------------------
    for _ in range(samples_per_class):
        throttle = np.random.uniform(0.75, 0.95)
        load = throttle * 100.0 + np.random.normal(0, 1.5)
        rpm = 1800 + (throttle * 3333) + np.random.normal(0, 20)
        map_press = 14.9 + (throttle * 25.0) + np.random.normal(0, 0.3)
        
        norm_load = load / 100.0
        norm_rpm = rpm / 5000.0
        fuel_flow = (38.0 * norm_load * norm_rpm) + np.random.normal(0, 0.4)
        
        # Elevated EGT (+80 to +140 °C above nominal) & CHT (+30 to +60 °C)
        thermal_severity = np.random.uniform(0.6, 1.0)
        egt_avg = 720 + (norm_load * 85) + (thermal_severity * 95) + np.random.normal(0, 4.0)
        cht_avg = 145 + (norm_load * 28) + (thermal_severity * 38) + np.random.normal(0, 2.0)
        
        # Heat soak into oil
        oil_temp = 82 + (norm_load * 10) + (thermal_severity * 18) + np.random.normal(0, 1.0)
        temp_oil_drop = max(0.0, (oil_temp - 85) * 0.16)
        oil_press = 38.0 + (rpm / 5000.0) * 18.0 - temp_oil_drop + np.random.normal(0, 0.5)
        vibration_rms = 1.45 + (norm_load * 0.4) + np.random.normal(0, 0.08)

        data.append([rpm, cht_avg, egt_avg, oil_press, oil_temp, fuel_flow, map_press, load, vibration_rms])
        labels.append(1)

    # -------------------------------------------------------------------------
    # Class 2: LUBRICATION_DEGRADATION (Pump Cavitation / Bearing Wear)
    # -------------------------------------------------------------------------
    for _ in range(samples_per_class):
        throttle = np.random.uniform(0.50, 0.85)
        load = throttle * 100.0 + np.random.normal(0, 1.0)
        rpm = 1800 + (throttle * 3333) + np.random.normal(0, 20)
        map_press = 14.9 + (throttle * 25.0) + np.random.normal(0, 0.2)
        norm_load = load / 100.0
        norm_rpm = rpm / 5000.0
        fuel_flow = (38.0 * norm_load * norm_rpm) + np.random.normal(0, 0.3)
        
        egt_avg = 720 + (norm_load * 85) + np.random.normal(0, 4.0)
        cht_avg = 145 + (norm_load * 28) + np.random.normal(0, 1.5)
        
        # Severe oil pressure loss (drops to 18-30 PSI) + high oil temperature (105-122 °C)
        oil_press = np.random.uniform(18.0, 30.0) + np.random.normal(0, 0.5)
        oil_temp = np.random.uniform(105.0, 122.0) + np.random.normal(0, 1.0)
        # Elevated bearing friction vibration
        vibration_rms = np.random.uniform(2.8, 4.5) + np.random.normal(0, 0.1)

        data.append([rpm, cht_avg, egt_avg, oil_press, oil_temp, fuel_flow, map_press, load, vibration_rms])
        labels.append(2)

    # -------------------------------------------------------------------------
    # Class 3: RPM_INSTABILITY (Governor Cyclic Flutter / Ignition Surge)
    # -------------------------------------------------------------------------
    for _ in range(samples_per_class):
        throttle = np.random.uniform(0.60, 0.85)
        load = throttle * 100.0 + np.random.normal(0, 3.0) # Fluctuating load
        # Wide RPM oscillation
        base_rpm = 1800 + (throttle * 3333)
        rpm = base_rpm + np.random.choice([-1, 1]) * np.random.uniform(160, 380) + np.random.normal(0, 25)
        map_press = 14.9 + (throttle * 25.0) + np.random.normal(0, 0.6)
        norm_load = max(0.2, load / 100.0)
        norm_rpm = rpm / 5000.0
        fuel_flow = (38.0 * norm_load * norm_rpm) + np.random.normal(0, 0.6)
        
        egt_avg = 720 + (norm_load * 85) + np.random.normal(0, 6.0)
        cht_avg = 145 + (norm_load * 28) + np.random.normal(0, 2.0)
        oil_temp = 82 + (norm_load * 10) + np.random.normal(0, 1.0)
        temp_oil_drop = max(0.0, (oil_temp - 85) * 0.12)
        oil_press = 38.0 + (rpm / 5000.0) * 18.0 - temp_oil_drop + np.random.normal(0, 1.2)
        # Flutter vibration
        vibration_rms = np.random.uniform(2.2, 3.6) + np.random.normal(0, 0.12)

        data.append([rpm, cht_avg, egt_avg, oil_press, oil_temp, fuel_flow, map_press, load, vibration_rms])
        labels.append(3)

    return np.array(data, dtype=np.float32), np.array(labels, dtype=np.int32)

def serialize_tree(tree):
    """
    Serializes a scikit-learn DecisionTree object into a clean dictionary of lists.
    """
    return {
        'node_count': int(tree.node_count),
        'feature': [int(f) for f in tree.feature],
        'threshold': [float(t) for t in tree.threshold],
        'children_left': [int(l) for l in tree.children_left],
        'children_right': [int(r) for r in tree.children_right],
        'n_node_samples': [int(n) for n in tree.n_node_samples],
        'value': [v[0].tolist() for v in tree.value] # Shape (n_nodes, n_classes)
    }

def export_forest_to_json(forest, filepath, model_type='classifier'):
    """
    Exports an entire ensemble of DecisionTrees to JSON.
    """
    serialized_trees = [serialize_tree(estimator.tree_) for estimator in forest.estimators_]
    payload = {
        'model_type': model_type,
        'n_estimators': len(forest.estimators_),
        'n_features': int(forest.n_features_in_),
        'feature_names': FEATURE_NAMES,
        'trees': serialized_trees
    }
    if model_type == 'classifier':
        payload['n_classes'] = len(forest.classes_)
        payload['classes'] = [int(c) for c in forest.classes_]
        payload['class_labels'] = CLASS_NAMES
        payload['feature_importances'] = [float(fi) for fi in forest.feature_importances_]
    elif model_type == 'isolation_forest':
        payload['offset'] = float(forest.offset_)
        payload['max_samples'] = int(forest.max_samples_)

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
    print(f"Exported {model_type} JSON tree ensemble -> {filepath} ({os.path.getsize(filepath) / 1024:.1f} KB)")

def verify_json_engine_parity(rf_model, json_path, X_test, y_test, num_samples=100):
    """
    Verifies that recursive execution of exported JSON trees in Python matches
    scikit-learn predict_proba and predict with 100% equivalence.
    """
    with open(json_path, 'r', encoding='utf-8') as f:
        json_data = json.load(f)

    def eval_node(tree, node_idx, sample):
        feat = tree['feature'][node_idx]
        if feat == -2 or tree['children_left'][node_idx] == -1:
            val = np.array(tree['value'][node_idx], dtype=np.float64)
            return val / np.sum(val)
        if sample[feat] <= tree['threshold'][node_idx]:
            return eval_node(tree, tree['children_left'][node_idx], sample)
        else:
            return eval_node(tree, tree['children_right'][node_idx], sample)

    def eval_forest(json_forest, sample):
        probas = np.zeros(json_forest['n_classes'], dtype=np.float64)
        for tree in json_forest['trees']:
            probas += eval_node(tree, 0, sample)
        probas /= len(json_forest['trees'])
        return np.argmax(probas), probas

    matches = 0
    test_subset = X_test[:num_samples]
    sk_preds = rf_model.predict(test_subset)
    sk_probas = rf_model.predict_proba(test_subset)

    for i in range(len(test_subset)):
        pred_cls, probas = eval_forest(json_data, test_subset[i])
        if pred_cls == sk_preds[i] and np.allclose(probas, sk_probas[i], atol=1e-4):
            matches += 1

    parity = (matches / num_samples) * 100.0
    print(f"JSON Tree Evaluator vs scikit-learn Parity: {parity:.1f}% ({matches}/{num_samples} exact matches)")
    assert parity == 100.0, "JSON tree engine output deviated from scikit-learn!"

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(root_dir, 'models')
    os.makedirs(models_dir, exist_ok=True)

    # 1. Generate Dataset
    X, y = generate_synthetic_dataset(samples_per_class=1000)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=SEED, stratify=y)

    print(f"\nTrain set: {X_train.shape[0]} samples | Test set: {X_test.shape[0]} samples")

    # 2. Train Random Forest Classifier
    print("\n--- Training RandomForestClassifier (Fault Classification) ---")
    rf = RandomForestClassifier(
        n_estimators=50,
        max_depth=9,
        min_samples_split=4,
        random_state=SEED,
        n_jobs=1
    )
    rf.fit(X_train, y_train)

    rf_preds = rf.predict(X_test)
    rf_acc = accuracy_score(y_test, rf_preds)
    print(f"\nRandom Forest Test Accuracy: {rf_acc * 100:.2f}%", flush=True)
    print("\nClassification Report:", flush=True)
    print(classification_report(y_test, rf_preds, target_names=CLASS_NAMES, digits=4), flush=True)
    
    cm = confusion_matrix(y_test, rf_preds)
    print("Confusion Matrix:", flush=True)
    print(cm, flush=True)

    # 3. Train Isolation Forest (Anomaly Detection)
    # Train Isolation Forest primarily on Healthy data (Class 0) + tiny contamination
    print("\n--- Training IsolationForest (Anomaly Detection) ---", flush=True)
    X_train_healthy = X_train[y_train == 0]
    iso_forest = IsolationForest(
        n_estimators=50,
        max_samples=256,
        contamination=0.03,
        random_state=SEED,
        n_jobs=1
    )
    iso_forest.fit(X_train_healthy)

    # Evaluate Anomaly Scores on Test Set
    healthy_test = X_test[y_test == 0]
    anomaly_test = X_test[y_test != 0]

    healthy_scores = -iso_forest.score_samples(healthy_test) # Higher = more anomalous
    anomaly_scores = -iso_forest.score_samples(anomaly_test)

    print(f"Mean Anomaly Score (Healthy Test Data): {np.mean(healthy_scores):.4f} (std: {np.std(healthy_scores):.4f})")
    print(f"Mean Anomaly Score (Faulty Test Data):  {np.mean(anomaly_scores):.4f} (std: {np.std(anomaly_scores):.4f})")
    separation = np.mean(anomaly_scores) - np.mean(healthy_scores)
    print(f"Anomaly Separation Margin: +{separation:.4f}")

    # 4. Save Python Pickle / Joblib Models
    rf_pkl_path = os.path.join(models_dir, 'fault_classifier.pkl')
    iso_pkl_path = os.path.join(models_dir, 'isolation_forest.pkl')
    joblib.dump(rf, rf_pkl_path)
    joblib.dump(iso_forest, iso_pkl_path)
    print(f"\nSaved Python joblib models:\n  - {rf_pkl_path}\n  - {iso_pkl_path}")

    # 5. Export JSON Tree Ensembles for in-browser JavaScript Runtime
    rf_json_path = os.path.join(models_dir, 'fault_classifier.json')
    iso_json_path = os.path.join(models_dir, 'isolation_forest.json')
    export_forest_to_json(rf, rf_json_path, model_type='classifier')
    export_forest_to_json(iso_forest, iso_json_path, model_type='isolation_forest')

    # Verify 100% equivalence between exported JSON model and scikit-learn
    verify_json_engine_parity(rf, rf_json_path, X_test, y_test, num_samples=100)

    # 6. Save Metadata & Gini Feature Importances
    feature_importances = {name: float(imp) for name, imp in zip(FEATURE_NAMES, rf.feature_importances_)}
    sorted_importances = sorted(feature_importances.items(), key=lambda x: x[1], reverse=True)

    metadata = {
        'timestamp': pd.Timestamp.now().isoformat(),
        'feature_names': FEATURE_NAMES,
        'class_names': CLASS_NAMES,
        'test_accuracy': float(rf_acc),
        'confusion_matrix': cm.tolist(),
        'isolation_forest_separation': float(separation),
        'feature_importances': feature_importances,
        'top_features_ranked': sorted_importances,
        'disclaimer': 'Model performance is demonstrated on synthetic data and is not claimed as certified real-world engine predictive accuracy.'
    }
    meta_path = os.path.join(models_dir, 'model_metadata.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)
    # 7. Also write js/models-data.js for direct browser consumption
    js_models_path = os.path.join(root_dir, 'js', 'models-data.js')
    with open(rf_json_path, 'r', encoding='utf-8') as f:
        rf_data = json.load(f)
    with open(iso_json_path, 'r', encoding='utf-8') as f:
        iso_data = json.load(f)
    with open(meta_path, 'r', encoding='utf-8') as f:
        meta_data = json.load(f)
    
    js_content = (
        "/* Auto-generated trained ML model weights for AERO TWIN runtime */\n"
        f"window.AERO_ML_MODELS = {json.dumps({'fault_classifier': rf_data, 'isolation_forest': iso_data, 'metadata': meta_data})};\n"
    )
    with open(js_models_path, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"Exported browser model bundle -> {js_models_path}")

    print("\nFeature Importances (Gini):")
    for feat, imp in sorted_importances:
        print(f"  {feat:<16}: {imp * 100:>5.1f}%")

    print("\n==========================================================================")
    print("SUCCESS: Offline Model Training & Serialization Completed.")
    print("==========================================================================")

if __name__ == '__main__':
    main()
