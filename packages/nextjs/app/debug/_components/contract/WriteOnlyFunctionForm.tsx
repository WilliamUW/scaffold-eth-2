"use client";

import { useEffect, useState } from "react";
import { InheritanceTooltip } from "./InheritanceTooltip";
import { Abi, AbiFunction } from "abitype";
import { AbiParameter } from "abitype";
import { Address, TransactionReceipt } from "viem";
import { useContractWrite, useNetwork, useWaitForTransaction } from "wagmi";
import {
  ContractInput,
  TxReceipt,
  getFunctionInputKey,
  getInitialFormState,
  getParsedContractFunctionArgs,
} from "~~/app/debug/_components/contract";
import { IntegerInput } from "~~/components/scaffold-eth";
import { useTransactor } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getParsedError, notification } from "~~/utils/scaffold-eth";

type WriteOnlyFunctionFormProps = {
  abi: Abi;
  abiFunction: AbiFunction;
  onChange: () => void;
  contractAddress: Address;
  inheritedFrom?: string;
};

const transformAbiFunction = (abiFunction: AbiFunction): AbiFunction => {
  const transformComponents = (components: AbiParameter[], depth: number): AbiParameter[] => {
    // Base case: if depth is 1 or no components, return the original components
    if (depth === 1 || !components) {
      return components;
    }

    // Recursive case: wrap components in an additional tuple layer
    const wrappedComponents: AbiParameter = {
      internalType: `struct[]${depth > 2 ? "[]".repeat(depth - 1) : ""}`,
      name: `nested_${depth - 1}`,
      type: `tuple${"[]".repeat(depth - 1)}`,
      components: transformComponents(components, depth - 1),
    };

    return [wrappedComponents];
  };

  const adjustInput = (input: Extract<AbiParameter, { type: "tuple" | `tuple[${string}]` }>): AbiParameter => {
    if (input.type.startsWith("tuple[")) {
      const depth = (input.type.match(/\[\]/g) || []).length;
      return {
        ...input,
        components: transformComponents(input.components, depth),
      };
    } else if (input.components) {
      return {
        ...input,
        components: input.components.map(adjustInput),
      };
    }
    return input;
  };

  return {
    ...abiFunction,
    inputs: abiFunction.inputs.map(adjustInput),
  };
};

export const WriteOnlyFunctionForm = ({
  abi,
  abiFunction,
  onChange,
  contractAddress,
  inheritedFrom,
}: WriteOnlyFunctionFormProps) => {
  console.log("The inital getInitalFormState", getInitialFormState(abiFunction));
  const [form, setForm] = useState<Record<string, any>>(() => getInitialFormState(abiFunction));
  const [txValue, setTxValue] = useState<string | bigint>("");
  const { chain } = useNetwork();
  const writeTxn = useTransactor();
  const { targetNetwork } = useTargetNetwork();
  const writeDisabled = !chain || chain?.id !== targetNetwork.id;

  const {
    data: result,
    isLoading,
    writeAsync,
  } = useContractWrite({
    address: contractAddress,
    functionName: abiFunction.name,
    abi: abi,
    args: getParsedContractFunctionArgs(form),
  });

  const handleWrite = async () => {
    console.log("The form is", form);
    console.log("The constructed args are", getParsedContractFunctionArgs(form));
    if (writeAsync) {
      try {
        const makeWriteWithParams = () => writeAsync({ value: BigInt(txValue) });
        await writeTxn(makeWriteWithParams);
        onChange();
      } catch (e: any) {
        const message = getParsedError(e);
        notification.error(message);
      }
    }
  };

  const [displayedTxResult, setDisplayedTxResult] = useState<TransactionReceipt>();
  const { data: txResult } = useWaitForTransaction({
    hash: result?.hash,
  });
  useEffect(() => {
    setDisplayedTxResult(txResult);
  }, [txResult]);

  // TODO use `useMemo` to optimize also update in ReadOnlyFunctionForm
  const transformedFunction = transformAbiFunction(abiFunction);
  const inputs = transformedFunction.inputs.map((input, inputIndex) => {
    const key = getFunctionInputKey(abiFunction.name, input, inputIndex);
    return (
      <ContractInput
        key={key}
        setForm={updatedFormValue => {
          setDisplayedTxResult(undefined);
          setForm(updatedFormValue);
        }}
        form={form}
        stateObjectKey={key}
        paramType={input}
      />
    );
  });
  const zeroInputs = inputs.length === 0 && abiFunction.stateMutability !== "payable";

  return (
    <div className="py-5 space-y-3 first:pt-0 last:pb-1">
      <div className={`flex gap-3 ${zeroInputs ? "flex-row justify-between items-center" : "flex-col"}`}>
        <p className="font-medium my-0 break-words">
          {abiFunction.name}
          <InheritanceTooltip inheritedFrom={inheritedFrom} />
        </p>
        {inputs}
        {abiFunction.stateMutability === "payable" ? (
          <IntegerInput
            value={txValue}
            onChange={updatedTxValue => {
              setDisplayedTxResult(undefined);
              setTxValue(updatedTxValue);
            }}
            placeholder="value (wei)"
          />
        ) : null}
        <div className="flex justify-between gap-2">
          {!zeroInputs && (
            <div className="flex-grow basis-0">
              {displayedTxResult ? <TxReceipt txResult={displayedTxResult} /> : null}
            </div>
          )}
          <div
            className={`flex ${
              writeDisabled &&
              "tooltip before:content-[attr(data-tip)] before:right-[-10px] before:left-auto before:transform-none"
            }`}
            data-tip={`${writeDisabled && "Wallet not connected or in the wrong network"}`}
          >
            <button className="btn btn-secondary btn-sm" disabled={writeDisabled || isLoading} onClick={handleWrite}>
              {isLoading && <span className="loading loading-spinner loading-xs"></span>}
              Send 💸
            </button>
          </div>
        </div>
      </div>
      {zeroInputs && txResult ? (
        <div className="flex-grow basis-0">
          <TxReceipt txResult={txResult} />
        </div>
      ) : null}
    </div>
  );
};
